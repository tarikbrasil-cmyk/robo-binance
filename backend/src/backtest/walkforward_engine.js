import fs from 'fs';
import path from 'path';
import { loadHistoricalData } from '../data/historicalLoader.js';
import { simulateTrade } from '../execution/simulator.js';
import { calculateIndicators, loadStrategyConfig } from '../strategy/regime_engine.js';
import { buildModularParamsFromConfig } from '../strategy/ModularStrategyV6.js';

/**
 * Walk-Forward Optimization Engine (ModularV6)
 * Divides data into "In-Sample" (Training) and "Out-Of-Sample" (Testing) sliding windows.
 * Uses the same ModularStrategyV6 parameter space as the massive optimizer.
 */

const TRAIN_DAYS = 30;
const TEST_DAYS  = 15;

// ── Parameter grid aligned with ModularStrategyV6 ────────────────────────────
function generateParameterGrid(searchSpace = null) {
    const space = searchSpace || {
        rsiOversold:    [35, 45],
        rsiOverbought:  [55, 65],
        emaFastPeriod:  [20, 50],
        emaSlowPeriod:  [100, 200],
        atrMultiplier:  [2.5, 3.5],
        tpMultiplier:   [1.5, 3.0],
        useBreakout:    [false, true],
        useMeanReversion:[false],
        session:        ['NY', 'LONDON'],
        useSessionFilter:[true],
    };

    const grid = [];
    const keys  = Object.keys(space);
    const values = keys.map(k => space[k]);

    function recurse(idx, current) {
        if (idx === keys.length) {
            grid.push({ ...current });
            return;
        }
        for (const v of values[idx]) {
            current[keys[idx]] = v;
            recurse(idx + 1, current);
        }
    }
    recurse(0, {});
    return grid;
}

// Score function — same weighting as regime_validation_report
function scoreResult(res) {
    if (res.totalTrades < 5) return -Infinity;
    const pf = res.grossLoss < 0 ? Math.abs(res.grossProfit) / Math.abs(res.grossLoss) : 99;
    if (pf < 1.05) return -Infinity;
    return pf * 40 + res.winRate * 35 - res.maxDrawdown * 25;
}

export async function runWalkForward(symbol, globalStartTime, globalEndTime, searchSpace = null) {
    const configTemplate = loadStrategyConfig();
    const timeframe = configTemplate.trendStrategy?.timeframe || '5m';
    const mode = (process.env.BOT_MODE || 'FUTURES').toUpperCase();

    console.log(`\n=== WALK-FORWARD OPTIMIZATION [${symbol}] @ ${timeframe} [${mode}] ===`);
    console.log(`Janela: Treino=${TRAIN_DAYS}d  |  Teste=${TEST_DAYS}d\n`);

    const candles = await loadHistoricalData(symbol, timeframe, globalStartTime, globalEndTime, mode);
    if (!candles || candles.length < 500) {
        return console.error('[WFO] Dados insuficientes (< 500 candles). Amplie o período ou use timeframe menor.');
    }

    // Interval in ms for the chosen timeframe
    const TF_MS = {
        '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
        '30m': 1_800_000, '1h': 3_600_000, '4h': 14_400_000,
    };
    const candleMs  = TF_MS[timeframe] || 300_000;
    const trainMs   = TRAIN_DAYS * 24 * 60 * 60 * 1000;
    const testMs    = TEST_DAYS  * 24 * 60 * 60 * 1000;
    const trainCandles = Math.floor(trainMs / candleMs);
    const testCandles  = Math.floor(testMs  / candleMs);

    console.log('Pré-calculando indicadores...');
    const allIndicators = calculateIndicators(candles, configTemplate);

    const grid   = generateParameterGrid(searchSpace);
    console.log(`Grid: ${grid.length} combinações de parâmetros\n`);

    const oosResults   = [];
    let windowId       = 1;
    let startIdx       = Math.max(200, configTemplate.trendStrategy?.emaSlow ?? 200);

    while (startIdx + trainCandles + testCandles <= candles.length) {
        const trainEnd = startIdx + trainCandles;
        const testEnd  = trainEnd + testCandles;

        console.log(`--- Janela #${windowId} ---`);
        console.log(`  IN-SAMPLE : idx ${startIdx}–${trainEnd} (${new Date(candles[startIdx].ts).toISOString().slice(0,10)} → ${new Date(candles[trainEnd].ts).toISOString().slice(0,10)})`);
        console.log(`  OOS       : idx ${trainEnd}–${testEnd}  (${new Date(candles[trainEnd].ts).toISOString().slice(0,10)} → ${new Date(candles[testEnd - 1].ts).toISOString().slice(0,10)})`);

        // 1. Optimize IN-SAMPLE
        let bestScore  = -Infinity;
        let bestParams = null;

        for (const params of grid) {
            const simConfig = _applyModularParams(configTemplate, params);
            const res = _runSlice(candles, allIndicators, startIdx, trainEnd, simConfig, symbol);
            const s   = scoreResult(res);
            if (s > bestScore) {
                bestScore  = s;
                bestParams = params;
            }
        }

        if (!bestParams) {
            console.log(`  ⚠️  Nenhum parâmetro válido em In-Sample. Pulando janela.\n`);
            startIdx += testCandles;
            windowId++;
            continue;
        }

        console.log(`  🏆 Melhor IS: EMA ${bestParams.emaFastPeriod}/${bestParams.emaSlowPeriod} | RSI ${bestParams.rsiOversold}/${bestParams.rsiOverbought} | Score ${bestScore.toFixed(2)}`);

        // 2. Validate OUT-OF-SAMPLE
        const oosConfig = _applyModularParams(configTemplate, bestParams);
        const oosRes    = _runSlice(candles, allIndicators, trainEnd, testEnd, oosConfig, symbol);

        const oosPF = oosRes.grossLoss < 0 ? (Math.abs(oosRes.grossProfit) / Math.abs(oosRes.grossLoss)).toFixed(2) : '∞';
        console.log(`  📊 OOS: PnL $${oosRes.netProfit.toFixed(2)} | WR ${(oosRes.winRate*100).toFixed(1)}% | DD ${(oosRes.maxDrawdown*100).toFixed(1)}% | Trades ${oosRes.totalTrades} | PF ${oosPF}\n`);

        oosResults.push({
            windowId,
            params: bestParams,
            inSampleScore: bestScore,
            oos: oosRes,
        });

        startIdx += testCandles;
        windowId++;
    }

    return _buildReport(symbol, timeframe, oosResults, configTemplate);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _applyModularParams(base, params) {
    const cfg = JSON.parse(JSON.stringify(base));
    cfg.general = cfg.general || {};
    cfg.general.strategyName = 'MODULAR_V6_WFO';
    cfg.trendStrategy = {
        ...(cfg.trendStrategy || {}),
        emaFast:          params.emaFastPeriod  ?? cfg.trendStrategy?.emaFast,
        emaSlow:          params.emaSlowPeriod  ?? cfg.trendStrategy?.emaSlow,
        emaHTF:           params.emaHTFPeriod   ?? cfg.trendStrategy?.emaHTF,
        rsiPeriod:        params.rsiPeriod      ?? cfg.trendStrategy?.rsiPeriod ?? 14,
        rsiOversold:      params.rsiOversold    ?? cfg.trendStrategy?.rsiOversold,
        rsiOverbought:    params.rsiOverbought  ?? cfg.trendStrategy?.rsiOverbought,
        useEmaHTF:        params.useEmaHTF      ?? false,
        atrMultiplierSL:  params.atrMultiplier  ?? cfg.trendStrategy?.atrMultiplierSL,
        atrMultiplierTP:  params.tpMultiplier   ?? cfg.trendStrategy?.atrMultiplierTP,
        useSessionFilter: params.useSessionFilter ?? true,
        session:          params.session        ?? 'NY',
        useBreakout:      params.useBreakout    ?? false,
        useMeanReversion: params.useMeanReversion ?? false,
        useCandleConfirmation: true,
    };
    return cfg;
}

function _runSlice(candles, allIndicators, startIdx, endIdx, config, symbol) {
    let balance     = 1000;
    let maxBalance  = balance;
    let maxDrawdown = 0;
    let wins = 0, grossProfit = 0, grossLoss = 0, totalTrades = 0;
    const cooldown  = config.general?.cooldownMinutes ?? 30;

    for (let i = startIdx; i < endIdx; i++) {
        const result = simulateTrade(
            candles[i], balance, symbol,
            allIndicators[i], allIndicators[i - 1],
            config, candles, i, candles[i - 1],
            maxBalance, 0, allIndicators
        );
        if (!result) continue;

        totalTrades++;
        const pnl = parseFloat(result.pnl);
        if (pnl > 0) { wins++; grossProfit += pnl; } else { grossLoss += pnl; }
        balance = result.newBalance;
        if (balance > maxBalance) maxBalance = balance;
        const dd = maxBalance > 0 ? (maxBalance - balance) / maxBalance : 0;
        if (dd > maxDrawdown) maxDrawdown = dd;

        const elapsed   = result.candlesElapsed || 0;
        const remaining = cooldown - elapsed;
        i += Math.max(elapsed - 1, 0) + Math.max(remaining, 0);
    }

    return {
        netProfit: balance - 1000, maxDrawdown, totalTrades,
        winRate:  totalTrades > 0 ? wins / totalTrades : 0,
        grossProfit, grossLoss,
    };
}

function _buildReport(symbol, timeframe, oosResults, configTemplate) {
    const logDir = path.join(process.cwd(), 'backtest_logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const n        = Math.max(oosResults.length, 1);
    const sumProfit    = oosResults.reduce((a, r) => a + r.oos.netProfit, 0);
    const avgWinRate   = oosResults.reduce((a, r) => a + r.oos.winRate, 0) / n;
    const avgDrawdown  = oosResults.reduce((a, r) => a + r.oos.maxDrawdown, 0) / n;
    const avgPF        = oosResults.reduce((a, r) => {
        const pf = r.oos.grossLoss < 0 ? Math.abs(r.oos.grossProfit) / Math.abs(r.oos.grossLoss) : 99;
        return a + pf;
    }, 0) / n;

    const robust = (avgPF > 1.3 && avgWinRate > 0.52 && avgDrawdown < 0.3);

    console.log(`\n════════════════════════════════════════════════`);
    console.log(`  RELATÓRIO FINAL WALK-FORWARD [${symbol}]`);
    console.log(`════════════════════════════════════════════════`);
    console.log(`  Janelas OOS     : ${oosResults.length}`);
    console.log(`  PnL Acumulado   : $${sumProfit.toFixed(2)}`);
    console.log(`  Win Rate médio  : ${(avgWinRate*100).toFixed(2)}%`);
    console.log(`  Profit Factor   : ${avgPF.toFixed(2)}`);
    console.log(`  Drawdown médio  : ${(avgDrawdown*100).toFixed(2)}%`);
    console.log(`  ROBUSTEZ        : ${robust ? '✅ SIM' : '❌ NÃO — continue em demo'}\n`);

    // Best params = highest OOS score across all windows
    const bestWindow = oosResults
        .filter(r => r.oos.totalTrades >= 5)
        .sort((a, b) => scoreResult(b.oos) - scoreResult(a.oos))[0];

    if (bestWindow) {
        const promotedConfig = _applyModularParams(configTemplate, bestWindow.params);
        promotedConfig.general.strategyName = `WFO_${symbol}_${timeframe}`;
        promotedConfig.general.lastPromotionSource = 'walkforward_report';
        promotedConfig.general.lastPromotionAt = new Date().toISOString();
        const promotedPath = path.join(process.cwd(), 'wfo_best_config.json');
        fs.writeFileSync(promotedPath, JSON.stringify(promotedConfig, null, 2));
        console.log(`  📝 Melhor config salva em wfo_best_config.json`);
        console.log(`     Params: EMA ${bestWindow.params.emaFastPeriod}/${bestWindow.params.emaSlowPeriod} | RSI ${bestWindow.params.rsiOversold}/${bestWindow.params.rsiOverbought}\n`);
    }

    const ts  = new Date().toISOString().replace(/[:.]/g, '-');
    const rpt = {
        symbol, timeframe,
        summary: { robust, avgPF, avgWinRate, avgDrawdown, sumProfit, windows: oosResults.length },
        windows: oosResults,
        bestParams: bestWindow?.params || null,
    };
    const reportPath = path.join(logDir, `walkforward_report_${symbol}_${ts}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(rpt, null, 2));
    console.log(`  💾 Relatório completo → ${reportPath}\n`);

    return rpt;
}

