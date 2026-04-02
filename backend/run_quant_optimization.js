/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  QUANTITATIVE STRATEGY OPTIMIZATION ENGINE
 *  ─────────────────────────────────────────
 *  Multi-regime, multi-symbol, large-scale grid search
 *  with cross-regime consistency scoring.
 *
 *  Targets: BTCUSDT, ETHUSDT on 5m timeframe
 *  Regimes: Bull (2021), Bear (2022), Sideways (2023)
 *  Combos:  ~22,500 parameter permutations per symbol
 *
 *  Output:  Top strategies per symbol with production configs
 * ══════════════════════════════════════════════════════════════════════════════
 */
import fs from 'fs';
import path from 'path';
import { hasDiskCache, loadFromDisk, toObjectArray, getData } from './src/benchmark/columnStore.js';
import { downloadDataset } from './src/benchmark/downloader.js';
import { calculateIndicators, loadStrategyConfig } from './src/strategy/regime_engine.js';
import { evaluateModularStrategyV6, getModularStrategyName } from './src/strategy/ModularStrategyV6.js';

// ═══════════════════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const SYMBOLS   = ['BTCUSDT', 'ETHUSDT'];
const TIMEFRAME = '5m';

const REGIMES = [
    { tag: 'BULL',     label: 'Bull Market',    startMs: new Date('2021-01-01T00:00:00Z').getTime(), endMs: new Date('2021-11-30T23:59:59Z').getTime() },
    { tag: 'BEAR',     label: 'Bear Market',    startMs: new Date('2022-04-01T00:00:00Z').getTime(), endMs: new Date('2022-12-31T23:59:59Z').getTime() },
    { tag: 'SIDEWAYS', label: 'Sideways Market', startMs: new Date('2023-01-01T00:00:00Z').getTime(), endMs: new Date('2023-10-31T23:59:59Z').getTime() },
];

// EMA period groupings — indicators recalculated per group for accuracy
const EMA_GROUPS = [
    { emaFast: 20, emaSlow: 100 },
    { emaFast: 20, emaSlow: 200 },
    { emaFast: 50, emaSlow: 200 },
];

// Strategy parameter grid (per EMA group)
const PARAM_GRID = {
    rsiOversold:          [25, 30, 35, 40, 45],
    rsiOverbought:        [55, 60, 65, 70, 75],
    atrMultiplier:        [1.5, 2.0, 2.5, 3.0, 3.5],
    tpMultiplier:         [1.5, 2.0, 2.5, 3.0, 4.0],
    mode:                 ['pullback', 'breakout', 'meanReversion'],
    session:              ['NY', 'LONDON'],
    useCandleConfirmation: [true, false],
};

// Cross-regime qualification filters
const FILTERS = {
    minTradesPerRegime: 15,
    minWinRate:         40,    // % — worst regime
    minProfitFactor:    1.0,   // worst regime
    maxDrawdown:        30,    // % — worst regime
};

const RISK_PER_TRADE = 0.02;  // 2% risk per trade
const INITIAL_BALANCE = 10000;

// ═══════════════════════════════════════════════════════════════════════════════
//  GRID GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

function generateGrid() {
    const combos = [];
    for (const emaGroup of EMA_GROUPS) {
        const keys = Object.keys(PARAM_GRID);
        function recurse(idx, current) {
            if (idx === keys.length) {
                // Map mode → useBreakout / useMeanReversion
                const mode = current.mode;
                const params = {
                    ...current,
                    emaFastPeriod: emaGroup.emaFast,
                    emaSlowPeriod: emaGroup.emaSlow,
                    emaHTFPeriod: 1000,
                    useEmaHTF: false,
                    rsiPeriod: 14,
                    useSessionFilter: true,
                    useMacd: false,
                    useBreakout: mode === 'breakout',
                    useMeanReversion: mode === 'meanReversion',
                };
                delete params.mode;
                combos.push(params);
                return;
            }
            for (const v of PARAM_GRID[keys[idx]]) {
                current[keys[idx]] = v;
                recurse(idx + 1, current);
            }
        }
        recurse(0, {});
    }
    return combos;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  IMPROVED BACKTEST ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function improvedBacktest(candles, indicators, params, symbol) {
    let balance     = INITIAL_BALANCE;
    const initialBal = balance;
    let peakBalance = balance;
    let maxDrawdown = 0;
    const trades    = [];
    const dailyReturns = [];
    let lastDayBalance = balance;
    let lastDay = null;

    const warmup = Math.max(250, params.emaSlowPeriod || 0);
    let cooldownUntil = 0;

    for (let i = warmup; i < candles.length; i++) {
        // Track daily returns for Sharpe
        const day = Math.floor(candles[i].ts / 86400000);
        if (lastDay !== null && day !== lastDay) {
            dailyReturns.push((balance - lastDayBalance) / lastDayBalance);
            lastDayBalance = balance;
        }
        lastDay = day;

        // Cooldown: 12 candles = 1 hour on 5m
        if (i < cooldownUntil) continue;

        const signal = evaluateModularStrategyV6(candles, indicators, i, params, symbol);
        if (!signal) continue;

        const entry = signal.entryPrice;
        const tp    = signal.takeProfitPrice;
        const sl    = signal.stopLossPrice;
        const side  = signal.signal;

        // Calculate actual risk:reward ratio from ATR-based levels
        const slDist = Math.abs(entry - sl);
        const tpDist = Math.abs(tp - entry);
        if (slDist === 0) continue;
        const rr = tpDist / slDist;

        let result = null;
        for (let j = i + 1; j < candles.length && j - i <= 288; j++) { // Max 24h
            const c = candles[j];
            const hitTP = side === 'BUY' ? c.high >= tp : c.low <= tp;
            const hitSL = side === 'BUY' ? c.low <= sl  : c.high >= sl;

            if (hitTP && hitSL) {
                // Both hit same candle — conservative: SL first
                result = { win: false, elapsed: j - i };
                break;
            }
            if (hitSL) {
                result = { win: false, elapsed: j - i };
                break;
            }
            if (hitTP) {
                result = { win: true, elapsed: j - i };
                break;
            }
        }

        if (result) {
            const pnl = result.win
                ? balance * RISK_PER_TRADE * rr   // Win: gain proportional to R:R
                : -balance * RISK_PER_TRADE;       // Loss: lose risk amount
            balance += pnl;
            trades.push({ win: result.win, pnl, rr, elapsed: result.elapsed });
            peakBalance = Math.max(peakBalance, balance);
            if (peakBalance > 0) {
                maxDrawdown = Math.max(maxDrawdown, (peakBalance - balance) / peakBalance);
            }
            cooldownUntil = i + result.elapsed + 12;
            i += result.elapsed;
        }
    }

    // Final daily return
    if (balance !== lastDayBalance && lastDayBalance > 0) {
        dailyReturns.push((balance - lastDayBalance) / lastDayBalance);
    }

    const wins = trades.filter(t => t.win).length;
    const wr = trades.length > 0 ? (wins / trades.length) * 100 : 0;
    const grossProfit = trades.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
    const grossLoss   = Math.abs(trades.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0));
    const pf = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99 : 0);

    // Sharpe Ratio (annualized)
    const avgReturn = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
    const stdReturn = dailyReturns.length > 1
        ? Math.sqrt(dailyReturns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / (dailyReturns.length - 1))
        : 1;
    const sharpe = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(365) : 0;

    // Expectancy (avg PnL per trade as % of initial balance)
    const avgPnlPct = trades.length > 0 ? (trades.reduce((a, t) => a + t.pnl, 0) / trades.length / initialBal) * 100 : 0;

    return {
        tradesCount:  trades.length,
        winRate:      wr,
        profitFactor: pf,
        totalPnl:     balance - initialBal,
        totalPnlPct:  ((balance - initialBal) / initialBal) * 100,
        maxDrawdown:  maxDrawdown * 100,
        finalBalance: balance,
        sharpeRatio:  sharpe,
        expectancy:   avgPnlPct,
        avgRR:        trades.length > 0 ? trades.filter(t => t.win).reduce((a, t) => a + t.rr, 0) / Math.max(wins, 1) : 0,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PARAMETER KEY (for grouping cross-regime results)
// ═══════════════════════════════════════════════════════════════════════════════

function paramKey(params) {
    return `${params.emaFastPeriod}_${params.emaSlowPeriod}_${params.rsiOversold}_${params.rsiOverbought}_${params.atrMultiplier}_${params.tpMultiplier}_${params.useBreakout}_${params.useMeanReversion}_${params.session}_${params.useCandleConfirmation}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CROSS-REGIME SCORING
// ═══════════════════════════════════════════════════════════════════════════════

function crossRegimeScore(regimeResults) {
    // regimeResults: { BULL: metrics, BEAR: metrics, SIDEWAYS: metrics }
    const tags = Object.keys(regimeResults);
    if (tags.length < 3) return -Infinity;

    const wrs     = tags.map(t => regimeResults[t].winRate);
    const pfs     = tags.map(t => regimeResults[t].profitFactor);
    const dds     = tags.map(t => regimeResults[t].maxDrawdown);
    const sharpes = tags.map(t => regimeResults[t].sharpeRatio);
    const trades  = tags.map(t => regimeResults[t].tradesCount);
    const pnls    = tags.map(t => regimeResults[t].totalPnlPct);

    const minWR      = Math.min(...wrs);
    const minPF      = Math.min(...pfs);
    const maxDD      = Math.max(...dds);
    const avgSharpe  = sharpes.reduce((a, b) => a + b, 0) / sharpes.length;
    const minTrades  = Math.min(...trades);
    const totalPnl   = pnls.reduce((a, b) => a + b, 0);
    const consistency = Math.min(...wrs) / Math.max(...wrs);

    // Hard filters
    if (minTrades < FILTERS.minTradesPerRegime) return -Infinity;
    if (minWR < FILTERS.minWinRate)             return -Infinity;
    if (minPF < FILTERS.minProfitFactor)        return -Infinity;
    if (maxDD > FILTERS.maxDrawdown)            return -Infinity;

    // Composite score (higher = better)
    const score =
        (minWR / 100)                    * 0.25 +   // Worst-case win rate
        Math.min(minPF / 3, 1)           * 0.25 +   // Worst-case profit factor
        Math.min(Math.max(avgSharpe, 0) / 2, 1) * 0.20 +  // Risk-adjusted returns
        consistency                      * 0.15 -   // Cross-regime consistency
        (maxDD / 100)                    * 0.15;     // Drawdown penalty

    return score;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN OPTIMIZATION LOOP
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
    const startTime = Date.now();
    const baseConfig = (() => { try { return loadStrategyConfig(); } catch { return {}; } })();
    const grid = generateGrid();

    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     QUANTITATIVE STRATEGY OPTIMIZATION ENGINE               ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Symbols:      ${SYMBOLS.join(', ')}`);
    console.log(`║  Timeframe:    ${TIMEFRAME}`);
    console.log(`║  Regimes:      ${REGIMES.map(r => r.tag).join(', ')}`);
    console.log(`║  EMA Groups:   ${EMA_GROUPS.map(g => `${g.emaFast}/${g.emaSlow}`).join(', ')}`);
    console.log(`║  Grid Size:    ${grid.length} parameter combinations`);
    console.log(`║  Total Runs:   ${grid.length * SYMBOLS.length * REGIMES.length} backtests`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log();

    // ── Phase 1: Data Download ────────────────────────────────────────────────
    console.log('━━━ PHASE 1: DATA ACQUISITION ━━━');
    for (const regime of REGIMES) {
        for (const symbol of SYMBOLS) {
            const tag = regime.tag;
            if (hasDiskCache(symbol, TIMEFRAME, tag)) {
                loadFromDisk(symbol, TIMEFRAME, tag);
                const data = getData(symbol, TIMEFRAME);
                console.log(`  [CACHE] ${symbol} ${TIMEFRAME} ${tag} → ${data?.length || 0} candles`);
            } else {
                console.log(`  [DOWNLOAD] ${symbol} ${TIMEFRAME} ${tag}...`);
                await downloadDataset(symbol, TIMEFRAME, regime.startMs, regime.endMs, tag);
                const data = getData(symbol, TIMEFRAME);
                console.log(`  [OK] ${symbol} ${TIMEFRAME} ${tag} → ${data?.length || 0} candles`);
            }
        }
    }
    console.log();

    // ── Phase 2: Run Grid Search ──────────────────────────────────────────────
    console.log('━━━ PHASE 2: GRID SEARCH OPTIMIZATION ━━━');

    // Store all results keyed by (symbol, paramKey) → { BULL: metrics, BEAR: metrics, SIDEWAYS: metrics }
    const allResults = {};  // symbol → { paramKey → { regime → metrics, params } }

    let totalCompleted = 0;
    const totalRuns = grid.length * SYMBOLS.length * REGIMES.length;

    for (const symbol of SYMBOLS) {
        allResults[symbol] = {};

        for (const regime of REGIMES) {
            const tag = regime.tag;

            // Load data from disk cache (replaces in-memory store)
            loadFromDisk(symbol, TIMEFRAME, tag);
            const rawCandles = toObjectArray(symbol, TIMEFRAME);

            // CRITICAL: Filter candles to only the regime's date range.
            // The disk cache may contain merged data from multiple regimes.
            const candles = rawCandles.filter(c => c.ts >= regime.startMs && c.ts <= regime.endMs);

            console.log(`  [DATA] ${symbol} ${regime.tag}: ${rawCandles.length} raw → ${candles.length} filtered candles`);

            if (candles.length < 300) {
                console.warn(`  [SKIP] ${symbol} ${regime.tag}: only ${candles.length} candles`);
                totalCompleted += grid.length;
                continue;
            }

            // Group grid by EMA pair to reuse indicators
            const emaGroupMap = new Map();
            for (const params of grid) {
                const emaKey = `${params.emaFastPeriod}_${params.emaSlowPeriod}`;
                if (!emaGroupMap.has(emaKey)) emaGroupMap.set(emaKey, []);
                emaGroupMap.get(emaKey).push(params);
            }

            for (const [emaKey, groupParams] of emaGroupMap) {
                const [emaFast, emaSlow] = emaKey.split('_').map(Number);

                // Calculate indicators ONCE per EMA group
                const indicators = calculateIndicators(candles, {
                    ...baseConfig,
                    trendStrategy: {
                        ...(baseConfig.trendStrategy || {}),
                        emaFast,
                        emaSlow,
                        emaHTF: 1000,
                        rsiPeriod: 14,
                        atrPeriod: 14,
                        adxPeriod: 14,
                    },
                });

                // Run all param combos against this indicator set
                for (const params of groupParams) {
                    const metrics = improvedBacktest(candles, indicators, params, symbol);
                    totalCompleted++;

                    const pk = paramKey(params);
                    if (!allResults[symbol][pk]) {
                        allResults[symbol][pk] = { params, regimes: {} };
                    }
                    allResults[symbol][pk].regimes[regime.tag] = metrics;

                    if (totalCompleted % 500 === 0) {
                        const pct = ((totalCompleted / totalRuns) * 100).toFixed(1);
                        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
                        process.stdout.write(`\r  [PROGRESS] ${totalCompleted}/${totalRuns} (${pct}%) | ${elapsed}s elapsed`);
                    }
                }
            }

            console.log(`\n  [DONE] ${symbol} × ${regime.tag}: ${candles.length} candles processed`);
        }
    }

    const searchTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n  Grid search completed in ${searchTime}s (${totalRuns} backtests)\n`);

    // ── Phase 3: Cross-Regime Scoring ─────────────────────────────────────────
    console.log('━━━ PHASE 3: CROSS-REGIME ANALYSIS ━━━');

    const rankedStrategies = {};

    for (const symbol of SYMBOLS) {
        const candidates = [];

        for (const [pk, entry] of Object.entries(allResults[symbol])) {
            const score = crossRegimeScore(entry.regimes);
            if (score > -Infinity) {
                const tags = Object.keys(entry.regimes);
                candidates.push({
                    symbol,
                    params: entry.params,
                    regimes: entry.regimes,
                    score,
                    summary: {
                        avgWR:      tags.reduce((a, t) => a + entry.regimes[t].winRate, 0) / tags.length,
                        minWR:      Math.min(...tags.map(t => entry.regimes[t].winRate)),
                        avgPF:      tags.reduce((a, t) => a + entry.regimes[t].profitFactor, 0) / tags.length,
                        minPF:      Math.min(...tags.map(t => entry.regimes[t].profitFactor)),
                        maxDD:      Math.max(...tags.map(t => entry.regimes[t].maxDrawdown)),
                        avgSharpe:  tags.reduce((a, t) => a + entry.regimes[t].sharpeRatio, 0) / tags.length,
                        totalPnlPct: tags.reduce((a, t) => a + entry.regimes[t].totalPnlPct, 0),
                        totalTrades: tags.reduce((a, t) => a + entry.regimes[t].tradesCount, 0),
                    },
                });
            }
        }

        candidates.sort((a, b) => b.score - a.score);
        rankedStrategies[symbol] = candidates;

        console.log(`  ${symbol}: ${candidates.length} strategies passed cross-regime filters (from ${Object.keys(allResults[symbol]).length} tested)`);
    }

    console.log();

    // ── Phase 4: Results Output ───────────────────────────────────────────────
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                   OPTIMIZATION RESULTS                      ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log();

    const topN = 5;
    const winners = {};

    for (const symbol of SYMBOLS) {
        const top = rankedStrategies[symbol].slice(0, topN);

        console.log(`┌─────────────────────────────────────────────────────────────┐`);
        console.log(`│  TOP ${topN} STRATEGIES: ${symbol}                                    │`);
        console.log(`├─────────────────────────────────────────────────────────────┤`);

        if (top.length === 0) {
            console.log(`│  No strategies passed cross-regime filters.                 │`);
            console.log(`│  Consider relaxing filter thresholds.                       │`);
            console.log(`└─────────────────────────────────────────────────────────────┘`);
            continue;
        }

        for (let i = 0; i < top.length; i++) {
            const s = top[i];
            const mode = s.params.useBreakout ? 'BREAKOUT' : (s.params.useMeanReversion ? 'MEAN_REV' : 'PULLBACK');

            console.log(`│                                                             │`);
            console.log(`│  RANK #${i + 1}  Score: ${s.score.toFixed(4)}                              │`);
            console.log(`│  Mode: ${mode.padEnd(10)} | EMA ${s.params.emaFastPeriod}/${s.params.emaSlowPeriod} | Session: ${s.params.session}`);
            console.log(`│  RSI: ${s.params.rsiOversold}/${s.params.rsiOverbought} | SL: ${s.params.atrMultiplier}x ATR | TP: ${s.params.tpMultiplier}x ATR`);
            console.log(`│  CandleConfirm: ${s.params.useCandleConfirmation}`);
            console.log(`│  ──────────────────────────────────────────────────────`);
            console.log(`│  Avg WR: ${s.summary.avgWR.toFixed(1)}% | Min WR: ${s.summary.minWR.toFixed(1)}% | Avg PF: ${s.summary.avgPF.toFixed(2)}`);
            console.log(`│  Max DD: ${s.summary.maxDD.toFixed(1)}% | Avg Sharpe: ${s.summary.avgSharpe.toFixed(2)} | Total PnL: ${s.summary.totalPnlPct.toFixed(1)}%`);
            console.log(`│  Total Trades: ${s.summary.totalTrades}`);
            console.log(`│  ── Per Regime ──`);
            for (const tag of ['BULL', 'BEAR', 'SIDEWAYS']) {
                const r = s.regimes[tag];
                if (r) {
                    console.log(`│   ${tag.padEnd(8)}: WR ${r.winRate.toFixed(1)}% | PF ${r.profitFactor.toFixed(2)} | DD ${r.maxDrawdown.toFixed(1)}% | Sharpe ${r.sharpeRatio.toFixed(2)} | Trades ${r.tradesCount} | PnL ${r.totalPnlPct.toFixed(1)}%`);
                }
            }
        }
        console.log(`└─────────────────────────────────────────────────────────────┘`);
        console.log();

        if (top.length > 0) {
            winners[symbol] = top[0];
        }
    }

    // ── Phase 5: Comparison Table ─────────────────────────────────────────────
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║              CROSS-SYMBOL COMPARISON TABLE                  ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');

    const allTopCandidates = [];
    for (const symbol of SYMBOLS) {
        for (const s of rankedStrategies[symbol].slice(0, 5)) {
            const mode = s.params.useBreakout ? 'BRK' : (s.params.useMeanReversion ? 'MR' : 'PB');
            allTopCandidates.push({
                symbol,
                mode,
                ema: `${s.params.emaFastPeriod}/${s.params.emaSlowPeriod}`,
                rsi: `${s.params.rsiOversold}/${s.params.rsiOverbought}`,
                sl: `${s.params.atrMultiplier}x`,
                tp: `${s.params.tpMultiplier}x`,
                session: s.params.session,
                score: s.score.toFixed(4),
                avgWR: s.summary.avgWR.toFixed(1) + '%',
                minWR: s.summary.minWR.toFixed(1) + '%',
                avgPF: s.summary.avgPF.toFixed(2),
                maxDD: s.summary.maxDD.toFixed(1) + '%',
                sharpe: s.summary.avgSharpe.toFixed(2),
                pnl: s.summary.totalPnlPct.toFixed(1) + '%',
                trades: s.summary.totalTrades,
            });
        }
    }

    console.log(`║ ${'Sym'.padEnd(7)} ${'Mode'.padEnd(5)} ${'EMA'.padEnd(8)} ${'RSI'.padEnd(6)} ${'SL'.padEnd(5)} ${'TP'.padEnd(5)} ${'Sess'.padEnd(5)} ${'Score'.padEnd(7)} ${'AvgWR'.padEnd(6)} ${'MinWR'.padEnd(6)} ${'PF'.padEnd(5)} ${'MaxDD'.padEnd(6)} ${'Shrp'.padEnd(5)} ${'PnL'.padEnd(8)} ${'#Tr'.padEnd(4)} ║`);
    console.log(`║${'─'.repeat(62)}║`);
    for (const c of allTopCandidates) {
        console.log(`║ ${c.symbol.padEnd(7)} ${c.mode.padEnd(5)} ${c.ema.padEnd(8)} ${c.rsi.padEnd(6)} ${c.sl.padEnd(5)} ${c.tp.padEnd(5)} ${c.session.padEnd(5)} ${c.score.padEnd(7)} ${c.avgWR.padEnd(6)} ${c.minWR.padEnd(6)} ${c.avgPF.padEnd(5)} ${c.maxDD.padEnd(6)} ${c.sharpe.padEnd(5)} ${c.pnl.padEnd(8)} ${String(c.trades).padEnd(4)} ║`);
    }
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log();

    // ── Phase 6: Save Production Configs ──────────────────────────────────────
    console.log('━━━ PHASE 6: PRODUCTION CONFIG GENERATION ━━━');

    const configDir = path.join(process.cwd(), 'config');
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

    const strategyConfigs = [];

    for (const symbol of SYMBOLS) {
        const winner = winners[symbol];
        if (!winner) {
            console.log(`  [SKIP] No winner found for ${symbol}`);
            continue;
        }

        const mode = winner.params.useBreakout ? 'Breakout' : (winner.params.useMeanReversion ? 'MeanRev' : 'Pullback');
        const base = symbol.replace('USDT', '');
        const strategyName = `${base}_Quantum_${mode}_v1`;

        const config = {
            general: {
                strategyName,
                cooldownMinutes: 60,
                maxTradesPerDay: 10,
                minEntryIntervalHours: 1,
                maxSpreadPercent: 0.0005,
                maxDailyLoss: 0.05,
                maxDrawdownStop: 0.15,
                maxConcurrentTrades: 2,
                avoidTimeStartUTC: '23:59',
                avoidTimeEndUTC: '00:01',
                lastPromotionSource: 'quant_optimization',
                lastPromotionAt: new Date().toISOString(),
                lastUpdatedAt: new Date().toISOString(),
                lastUpdatedSource: 'quant_optimization',
            },
            trendStrategy: {
                timeframe: '5m',
                emaFast: winner.params.emaFastPeriod,
                emaSlow: winner.params.emaSlowPeriod,
                emaHTF: 1000,
                rsiPeriod: 14,
                atrPeriod: 14,
                adxPeriod: 14,
                rsiOversold: winner.params.rsiOversold,
                rsiOverbought: winner.params.rsiOverbought,
                useEmaHTF: false,
                atrMultiplierSL: winner.params.atrMultiplier,
                atrMultiplierTP: winner.params.tpMultiplier,
                useCandleConfirmation: winner.params.useCandleConfirmation,
                useBreakout: winner.params.useBreakout,
                useMeanReversion: winner.params.useMeanReversion,
                useMacd: false,
                leverage: 10,
                useSessionFilter: true,
                session: winner.params.session,
            },
            risk: {
                maxAccountExposure: 0.2,
                maxRiskPerTrade: 0.02,
                maxFundingRate: 0.0005,
                killSwitchLosses: 5,
                killSwitchPauseHours: 6,
            },
            regime: {
                minVolatilityPercent: 0.001,
                trendAdxThreshold: 25,
                rangingAdxThreshold: 20,
            },
            allowedSymbols: [`${base}/USDT`, `${base}/USDT:USDT`],
            performance: {
                crossRegimeScore: winner.score,
                avgWinRate: winner.summary.avgWR,
                minWinRate: winner.summary.minWR,
                avgProfitFactor: winner.summary.avgPF,
                minProfitFactor: winner.summary.minPF,
                maxDrawdown: winner.summary.maxDD,
                avgSharpeRatio: winner.summary.avgSharpe,
                totalPnlPct: winner.summary.totalPnlPct,
                totalTrades: winner.summary.totalTrades,
                perRegime: winner.regimes,
                optimizedAt: new Date().toISOString(),
                dataRegimes: REGIMES.map(r => `${r.tag}: ${new Date(r.startMs).toISOString().slice(0, 10)} → ${new Date(r.endMs).toISOString().slice(0, 10)}`),
            },
        };

        const filePath = path.join(configDir, `strategy_${symbol.toLowerCase()}_quantum.json`);
        fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
        console.log(`  [SAVED] ${strategyName} → ${filePath}`);

        strategyConfigs.push({
            name: strategyName,
            symbol,
            config,
            winner,
        });
    }

    // Save full optimization report
    const report = {
        timestamp: new Date().toISOString(),
        searchConfig: {
            symbols: SYMBOLS,
            timeframe: TIMEFRAME,
            emaGroups: EMA_GROUPS,
            gridSize: grid.length,
            totalRuns: totalRuns,
            filters: FILTERS,
        },
        winners: Object.fromEntries(
            Object.entries(winners).map(([sym, w]) => [sym, {
                params: w.params,
                score: w.score,
                summary: w.summary,
                regimes: w.regimes,
            }])
        ),
        top5: Object.fromEntries(
            SYMBOLS.map(sym => [sym, rankedStrategies[sym].slice(0, 5).map(s => ({
                params: s.params,
                score: s.score,
                summary: s.summary,
            }))])
        ),
        executionTime: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
    };

    fs.writeFileSync(path.join(process.cwd(), 'quant_optimization_report.json'), JSON.stringify(report, null, 2));
    console.log(`  [SAVED] Full report → quant_optimization_report.json`);
    console.log();

    // ── Summary ───────────────────────────────────────────────────────────────
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    OPTIMIZATION COMPLETE                     ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Execution Time:    ${totalTime}s`);
    console.log(`║  Total Backtests:   ${totalRuns}`);

    for (const symbol of SYMBOLS) {
        const w = winners[symbol];
        if (w) {
            const mode = w.params.useBreakout ? 'BREAKOUT' : (w.params.useMeanReversion ? 'MEAN_REV' : 'PULLBACK');
            console.log(`║`);
            console.log(`║  🏆 ${symbol} Winner: ${mode} EMA ${w.params.emaFastPeriod}/${w.params.emaSlowPeriod}`);
            console.log(`║     Score: ${w.score.toFixed(4)} | WR: ${w.summary.avgWR.toFixed(1)}% | PF: ${w.summary.avgPF.toFixed(2)} | DD: ${w.summary.maxDD.toFixed(1)}% | Sharpe: ${w.summary.avgSharpe.toFixed(2)}`);
        }
    }
    console.log('╚══════════════════════════════════════════════════════════════╝');

    return { winners, rankedStrategies, strategyConfigs };
}

main().catch(err => {
    console.error('[FATAL]', err);
    process.exit(1);
});
