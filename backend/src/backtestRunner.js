import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { simulateTrade } from './execution/simulator.js';
import { loadHistoricalData } from './data/historicalLoader.js';
import { logBacktestResult, logDebugCandles } from './utils/backtestLogger.js';
import { updateUIBacktest } from './ui/backtestUI.js';
import { calculateIndicators, loadStrategyConfig } from './strategy/regime_engine.js';
import { getStrategySnapshot, displayStrategyPanel, saveStrategySnapshot } from './utils/strategySnapshot.js';

// ─── Interactive Menu ──────────────────────────────────────────────────────────

async function startBacktestMenu() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(resolve => rl.question(q, resolve));

    const snapshot = getStrategySnapshot();
    displayStrategyPanel(snapshot);

    console.log('=== BACKTEST HISTÓRICO ADAPTATIVO ===');
    console.log('[1] Manual (Par único)');
    console.log('[4] Benchmark automático (períodos fixos)');
    
    const choice = await ask('\nEscolha uma opção: ');

    if (choice === '4') {
        rl.close();
        const { runAutomaticBenchmark } = await import('./benchmarkEngine.js');
        await runAutomaticBenchmark(1000);
        return;
    }

    const symbol           = await ask('Escolha o par (ex: BTCUSDT): ');
    const startTimeInput   = await ask('Data de início (YYYY-MM-DD): ');
    const endTimeInput     = await ask('Data final (YYYY-MM-DD): ');
    const balanceInput     = await ask('Saldo inicial (USDT) [default: 1000]: ');

    const startTime    = new Date(startTimeInput).getTime();
    const endTime      = new Date(endTimeInput).getTime();
    const initialBalance = balanceInput ? parseFloat(balanceInput) : 1000;

    if (isNaN(startTime) || isNaN(endTime)) {
        console.error('Data inválida. Use o formato YYYY-MM-DD.');
        rl.close();
        return;
    }

    rl.close();
    console.log(`\nIniciando backtest para ${symbol} de ${startTimeInput} até ${endTimeInput}` +
                ` com saldo inicial de ${initialBalance} USDT...\n`);

    await runBacktest(symbol, startTime, endTime, initialBalance);
}

// ─── Core Engine ──────────────────────────────────────────────────────────────

/**
 * runBacktest — shared engine used by both interactive menu and programmatic API.
 *
 * @param {string}  symbol
 * @param {number}  startTime        - ms epoch
 * @param {number}  endTime          - ms epoch
 * @param {number}  balance          - starting account balance in USDT
 * @param {Object}  [overrideConfig] - optional config override for optimisation runs
 * @returns {Object} { trades, finalBalance, debugLog, summary }
 */
async function runBacktest(symbol, startTime, endTime, balance, overrideConfig = null) {
    const candles = await loadHistoricalData(symbol, '1m', startTime, endTime);
    if (!candles || candles.length === 0) {
        console.error('[backtestRunner] Nenhum dado encontrado para o período selecionado.');
        return { trades: [], finalBalance: balance, debugLog: [], summary: null };
    }
    console.log(`[backtestRunner] ${candles.length} candles carregados para ${symbol}.`);

    const config     = overrideConfig ?? loadStrategyConfig();
    const indicators = calculateIndicators(candles, config);

    let trades          = [];
    let debugLog        = [];
    let consecutiveWins = 0;
    let maxBalance      = balance;

    const startIdx = 200; // ensure EMA200 is warm

    for (let i = startIdx; i < candles.length; i++) {
        const tradeResult = simulateTrade(
            candles[i],
            balance,
            symbol,
            indicators[i],
            indicators[i - 1],
            config,
            candles,
            i,
            consecutiveWins,
            maxBalance,
            debugLog        // ← receives per-candle debug entries
        );

        if (tradeResult) {
            trades.push(tradeResult);
            balance = tradeResult.newBalance;

            if (balance > maxBalance) maxBalance = balance;

            if (parseFloat(tradeResult.pnl) > 0) {
                consecutiveWins++;
            } else {
                consecutiveWins = 0;
            }

            // BUG #4 FIX: Avoid double-skip.
            // candlesElapsed already advances i to the trade close candle.
            // Add cooldown ONLY if trade closed faster than the cooldown window.
            // This prevents excessively sparse trades in high-frequency periods.
            const cooldownFrames = config.general?.cooldownMinutes ?? 30;
            const elapsed = tradeResult.candlesElapsed ?? 0;

            if (elapsed > 0) {
                i += elapsed - 1;
            }

            // Only add remaining cooldown if the trade closed before cooldown expired
            const remainingCooldown = cooldownFrames - elapsed;
            if (remainingCooldown > 0) {
                i += remainingCooldown;
            }
        }

        if (i % 500 === 0 || i >= candles.length - 1) {
            updateUIBacktest(trades, balance);
        }
    }

    console.log(`\n[backtestRunner] Backtest concluído — ${symbol} | Saldo final: ${balance.toFixed(2)} USDT | Trades: ${trades.length}`);

    // ── Pre-Persistence: Capture Strategy Snapshot ────────────────────────
    const snapshot = getStrategySnapshot();
    saveStrategySnapshot(snapshot);

    // ── Persistence ────────────────────────────────────────────────────────
    const logDir   = path.join(process.cwd(), 'backtest_logs');
    const debugDir = path.join(logDir, 'debug');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const timestamp    = new Date().toISOString();
    const safeTs       = timestamp.replace(/[:.]/g, '-');
    const logFileCSV   = path.join(logDir, `${symbol}_backtest_adaptive_${safeTs}.csv`);
    const logFileJSON  = path.join(logDir, `${symbol}_backtest_adaptive_${safeTs}.json`);

    logBacktestResult(trades, logFileCSV, logFileJSON);
    logDebugCandles(debugLog, debugDir, symbol, timestamp);

    console.log(`[backtestRunner] Logs:\n  CSV  → ${logFileCSV}\n  JSON → ${logFileJSON}\n  Debug NDJSON → ${debugDir}`);

    // ── Summary ────────────────────────────────────────────────────────────
    const summary = buildSummary(trades, balance);
    if (trades.length < 5) {
        console.warn('\n⚠️  WARNING: Strategy generated too few trades for statistical validation.');
    }

    return { trades, finalBalance: balance, debugLog, summary };
}

/**
 * Build a statistics summary from the completed trade list.
 */
function buildSummary(trades, finalBalance) {
    if (trades.length === 0) return null;

    const pnls        = trades.map(t => parseFloat(t.pnl));
    const wins        = pnls.filter(p => p > 0);
    const losses      = pnls.filter(p => p <= 0);
    const totalPnl    = pnls.reduce((a, b) => a + b, 0);
    const grossWin    = wins.reduce((a, b) => a + b, 0);
    const grossLoss   = Math.abs(losses.reduce((a, b) => a + b, 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : Infinity;
    const maxLossPnl  = Math.min(...pnls);

    // Max Drawdown calculation based on trade balance history
    let peak = trades[0].newBalance - parseFloat(trades[0].pnl); // balance before first trade
    let maxDD = 0;
    
    let runningBalance = peak;
    for (const trade of trades) {
        runningBalance = trade.newBalance;
        if (runningBalance > peak) {
            peak = runningBalance;
        } else {
            const dd = (peak - runningBalance) / peak;
            if (dd > maxDD) maxDD = dd;
        }
    }

    const winRateNum = wins.length / trades.length;
    const lossRateNum = 1 - winRateNum;
    const avgWinNum = wins.length > 0 ? (grossWin / wins.length) : 0;
    const avgLossNum = losses.length > 0 ? (grossLoss / losses.length) : 0;
    const expectancy = (winRateNum * avgWinNum) - (lossRateNum * avgLossNum);

    return {
        trades:       trades.length,
        winRate:      (winRateNum * 100).toFixed(2) + '%',
        avgWin:       avgWinNum.toFixed(4),
        avgLoss:      (-avgLossNum).toFixed(4),
        profitFactor: isFinite(profitFactor) ? profitFactor.toFixed(3) : '∞',
        expectancy:   expectancy.toFixed(4),
        totalPnl:     totalPnl.toFixed(4),
        finalBalance: finalBalance.toFixed(4),
        maxLossTrade: maxLossPnl.toFixed(4),
        maxDrawdown:  (maxDD * 100).toFixed(2) + '%'
    };
}

// ─── Programmatic API for optimizer / validateBacktest ─────────────────────────

/**
 * Run a backtest non-interactively. Safe for parallel calls.
 *
 * @param {string}  symbol
 * @param {string}  startISO  - "YYYY-MM-DD"
 * @param {string}  endISO    - "YYYY-MM-DD"
 * @param {number}  balance
 * @param {Object}  [strategyConfig]  - optional override (for walk-forward, GA, etc.)
 */
export async function runBacktestProgrammatic(symbol, startISO, endISO, balance, strategyConfig = null) {
    const startTime = new Date(startISO).getTime();
    const endTime   = new Date(endISO).getTime();
    return runBacktest(symbol, startTime, endTime, balance, strategyConfig);
}

export { startBacktestMenu };
