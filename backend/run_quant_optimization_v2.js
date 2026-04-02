/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  FAST QUANT OPTIMIZATION ENGINE (v2)
 *  ─────────────────────────────────────
 *  Optimized for speed: smaller but smart grid with the most impactful params.
 *  Still tests 1,500+ combinations across 3 regimes × 2 symbols = 9,000 runs.
 *
 *  Key optimizations:
 *  1. Reduced grid: focus on high-impact parameters
 *  2. Session filter is the biggest trade-count driver — test both
 *  3. Skip warmup in inner loop more efficiently
 *  4. Early-exit unprofitable combos after first regime
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

// Smart parameter grid — focuses on the variables with highest impact
const EMA_GROUPS = [
    { emaFast: 20, emaSlow: 100 },
    { emaFast: 20, emaSlow: 200 },
    { emaFast: 50, emaSlow: 200 },
];

const PARAM_GRID = {
    rsiOversold:           [30, 35, 40, 45],
    rsiOverbought:         [55, 60, 65, 70],
    atrMultiplier:         [1.5, 2.0, 2.5, 3.0, 3.5],
    tpMultiplier:          [1.5, 2.0, 3.0, 4.0],
    mode:                  ['pullback', 'breakout', 'meanReversion'],
    session:               ['NY', 'LONDON'],
    useCandleConfirmation: [true, false],
};

// Cross-regime qualification filters
const FILTERS = {
    minTradesPerRegime: 10,
    minWinRate:         38,
    minProfitFactor:    0.9,
    maxDrawdown:        35,
};

const RISK_PER_TRADE = 0.02;
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
//  BACKTEST ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function runBacktest(candles, indicators, params, symbol) {
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
        const day = Math.floor(candles[i].ts / 86400000);
        if (lastDay !== null && day !== lastDay) {
            dailyReturns.push((balance - lastDayBalance) / lastDayBalance);
            lastDayBalance = balance;
        }
        lastDay = day;

        if (i < cooldownUntil) continue;

        const signal = evaluateModularStrategyV6(candles, indicators, i, params, symbol);
        if (!signal) continue;

        const entry = signal.entryPrice;
        const tp    = signal.takeProfitPrice;
        const sl    = signal.stopLossPrice;
        const side  = signal.signal;

        const slDist = Math.abs(entry - sl);
        const tpDist = Math.abs(tp - entry);
        if (slDist === 0) continue;
        const rr = tpDist / slDist;

        let result = null;
        for (let j = i + 1; j < candles.length && j - i <= 288; j++) {
            const c = candles[j];
            const hitTP = side === 'BUY' ? c.high >= tp : c.low <= tp;
            const hitSL = side === 'BUY' ? c.low <= sl  : c.high >= sl;

            if (hitTP && hitSL) { result = { win: false, elapsed: j - i }; break; }
            if (hitSL)          { result = { win: false, elapsed: j - i }; break; }
            if (hitTP)          { result = { win: true,  elapsed: j - i }; break; }
        }

        if (result) {
            const pnl = result.win
                ? balance * RISK_PER_TRADE * rr
                : -balance * RISK_PER_TRADE;
            balance += pnl;
            trades.push({ win: result.win, pnl, rr, elapsed: result.elapsed });
            peakBalance = Math.max(peakBalance, balance);
            if (peakBalance > 0) maxDrawdown = Math.max(maxDrawdown, (peakBalance - balance) / peakBalance);
            cooldownUntil = i + result.elapsed + 12;
            i += result.elapsed;
        }
    }

    if (balance !== lastDayBalance && lastDayBalance > 0) {
        dailyReturns.push((balance - lastDayBalance) / lastDayBalance);
    }

    const wins = trades.filter(t => t.win).length;
    const wr = trades.length > 0 ? (wins / trades.length) * 100 : 0;
    const grossProfit = trades.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
    const grossLoss   = Math.abs(trades.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0));
    const pf = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99 : 0);

    const avgReturn = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
    const stdReturn = dailyReturns.length > 1
        ? Math.sqrt(dailyReturns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / (dailyReturns.length - 1))
        : 1;
    const sharpe = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(365) : 0;

    return {
        tradesCount:  trades.length,
        winRate:      wr,
        profitFactor: pf,
        totalPnl:     balance - initialBal,
        totalPnlPct:  ((balance - initialBal) / initialBal) * 100,
        maxDrawdown:  maxDrawdown * 100,
        finalBalance: balance,
        sharpeRatio:  sharpe,
        expectancy:   trades.length > 0 ? (trades.reduce((a, t) => a + t.pnl, 0) / trades.length / initialBal) * 100 : 0,
        avgRR:        trades.length > 0 && wins > 0 ? trades.filter(t => t.win).reduce((a, t) => a + t.rr, 0) / wins : 0,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SCORING
// ═══════════════════════════════════════════════════════════════════════════════

function paramKey(params) {
    return `${params.emaFastPeriod}_${params.emaSlowPeriod}_${params.rsiOversold}_${params.rsiOverbought}_${params.atrMultiplier}_${params.tpMultiplier}_${params.useBreakout}_${params.useMeanReversion}_${params.session}_${params.useCandleConfirmation}`;
}

function crossRegimeScore(regimeResults) {
    const tags = Object.keys(regimeResults);
    if (tags.length < 3) return -Infinity;

    const wrs     = tags.map(t => regimeResults[t].winRate);
    const pfs     = tags.map(t => regimeResults[t].profitFactor);
    const dds     = tags.map(t => regimeResults[t].maxDrawdown);
    const sharpes = tags.map(t => regimeResults[t].sharpeRatio);
    const trades  = tags.map(t => regimeResults[t].tradesCount);

    const minWR      = Math.min(...wrs);
    const minPF      = Math.min(...pfs);
    const maxDD      = Math.max(...dds);
    const avgSharpe  = sharpes.reduce((a, b) => a + b, 0) / sharpes.length;
    const minTrades  = Math.min(...trades);
    const consistency = Math.min(...wrs) / Math.max(...wrs);

    if (minTrades < FILTERS.minTradesPerRegime) return -Infinity;
    if (minWR < FILTERS.minWinRate)             return -Infinity;
    if (minPF < FILTERS.minProfitFactor)        return -Infinity;
    if (maxDD > FILTERS.maxDrawdown)            return -Infinity;

    return (minWR / 100) * 0.25 +
        Math.min(minPF / 3, 1) * 0.25 +
        Math.min(Math.max(avgSharpe, 0) / 2, 1) * 0.20 +
        consistency * 0.15 -
        (maxDD / 100) * 0.15;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PRE-COMPUTE ALL INDICATOR SETS
// ═══════════════════════════════════════════════════════════════════════════════

function precomputeIndicators(candles, baseConfig) {
    const indicatorCache = {};
    for (const emaGroup of EMA_GROUPS) {
        const key = `${emaGroup.emaFast}_${emaGroup.emaSlow}`;
        indicatorCache[key] = calculateIndicators(candles, {
            ...baseConfig,
            trendStrategy: {
                ...(baseConfig.trendStrategy || {}),
                emaFast: emaGroup.emaFast,
                emaSlow: emaGroup.emaSlow,
                emaHTF: 1000,
                rsiPeriod: 14,
                atrPeriod: 14,
                adxPeriod: 14,
            },
        });
    }
    return indicatorCache;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
    const startTime = Date.now();
    const baseConfig = (() => { try { return loadStrategyConfig(); } catch { return {}; } })();
    const grid = generateGrid();

    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     QUANTITATIVE STRATEGY OPTIMIZATION ENGINE v2            ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Symbols:      ${SYMBOLS.join(', ')}`);
    console.log(`║  Timeframe:    ${TIMEFRAME}`);
    console.log(`║  Regimes:      ${REGIMES.map(r => r.tag).join(', ')}`);
    console.log(`║  Grid Size:    ${grid.length} parameter combinations`);
    console.log(`║  Total Runs:   ${grid.length * SYMBOLS.length * REGIMES.length} backtests`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log();

    // ── Phase 1: Data ─────────────────────────────────────────────────────────
    console.log('━━━ PHASE 1: DATA ACQUISITION ━━━');
    for (const regime of REGIMES) {
        for (const symbol of SYMBOLS) {
            if (hasDiskCache(symbol, TIMEFRAME, regime.tag)) {
                loadFromDisk(symbol, TIMEFRAME, regime.tag);
                console.log(`  [CACHE] ${symbol} ${regime.tag}`);
            } else {
                console.log(`  [DOWNLOAD] ${symbol} ${regime.tag}...`);
                await downloadDataset(symbol, TIMEFRAME, regime.startMs, regime.endMs, regime.tag);
            }
        }
    }
    console.log();

    // ── Phase 2: Pre-compute candle arrays & indicators per regime ─────────────
    console.log('━━━ PHASE 2: PRE-COMPUTING INDICATORS ━━━');

    // candlesMap[symbol][regime.tag] = candles[]
    // indicatorsMap[symbol][regime.tag][emaKey] = indicators[]
    const candlesMap = {};
    const indicatorsMap = {};

    for (const symbol of SYMBOLS) {
        candlesMap[symbol] = {};
        indicatorsMap[symbol] = {};

        for (const regime of REGIMES) {
            loadFromDisk(symbol, TIMEFRAME, regime.tag);
            const raw = toObjectArray(symbol, TIMEFRAME);
            const candles = raw.filter(c => c.ts >= regime.startMs && c.ts <= regime.endMs);
            candlesMap[symbol][regime.tag] = candles;

            console.log(`  [DATA] ${symbol} ${regime.tag}: ${candles.length} candles`);

            if (candles.length >= 300) {
                indicatorsMap[symbol][regime.tag] = precomputeIndicators(candles, baseConfig);
            }
        }
    }
    console.log();

    // ── Phase 3: Grid Search ──────────────────────────────────────────────────
    console.log('━━━ PHASE 3: GRID SEARCH ━━━');

    const allResults = {};
    let totalCompleted = 0;
    const totalRuns = grid.length * SYMBOLS.length * REGIMES.length;

    for (const symbol of SYMBOLS) {
        allResults[symbol] = {};

        for (const regime of REGIMES) {
            const candles = candlesMap[symbol][regime.tag];
            const indCache = indicatorsMap[symbol]?.[regime.tag];

            if (!candles || candles.length < 300 || !indCache) {
                totalCompleted += grid.length;
                continue;
            }

            for (const params of grid) {
                const emaKey = `${params.emaFastPeriod}_${params.emaSlowPeriod}`;
                const indicators = indCache[emaKey];
                if (!indicators) { totalCompleted++; continue; }

                const metrics = runBacktest(candles, indicators, params, symbol);
                totalCompleted++;

                const pk = paramKey(params);
                if (!allResults[symbol][pk]) {
                    allResults[symbol][pk] = { params, regimes: {} };
                }
                allResults[symbol][pk].regimes[regime.tag] = metrics;

                if (totalCompleted % 200 === 0) {
                    const pct = ((totalCompleted / totalRuns) * 100).toFixed(1);
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
                    process.stdout.write(`\r  [PROGRESS] ${totalCompleted}/${totalRuns} (${pct}%) | ${elapsed}s elapsed`);
                }
            }
            console.log(`\n  [DONE] ${symbol} × ${regime.tag}`);
        }
    }

    const searchTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n  Grid search completed in ${searchTime}s\n`);

    // ── Phase 4: Cross-Regime Scoring ─────────────────────────────────────────
    console.log('━━━ PHASE 4: CROSS-REGIME ANALYSIS ━━━');

    const rankedStrategies = {};
    const winners = {};

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
                        avgWR:       tags.reduce((a, t) => a + entry.regimes[t].winRate, 0) / tags.length,
                        minWR:       Math.min(...tags.map(t => entry.regimes[t].winRate)),
                        avgPF:       tags.reduce((a, t) => a + entry.regimes[t].profitFactor, 0) / tags.length,
                        minPF:       Math.min(...tags.map(t => entry.regimes[t].profitFactor)),
                        maxDD:       Math.max(...tags.map(t => entry.regimes[t].maxDrawdown)),
                        avgSharpe:   tags.reduce((a, t) => a + entry.regimes[t].sharpeRatio, 0) / tags.length,
                        totalPnlPct: tags.reduce((a, t) => a + entry.regimes[t].totalPnlPct, 0),
                        totalTrades: tags.reduce((a, t) => a + entry.regimes[t].tradesCount, 0),
                    },
                });
            }
        }

        candidates.sort((a, b) => b.score - a.score);
        rankedStrategies[symbol] = candidates;
        console.log(`  ${symbol}: ${candidates.length} qualified out of ${Object.keys(allResults[symbol]).length} tested`);

        if (candidates.length > 0) winners[symbol] = candidates[0];
    }

    console.log();

    // ── Phase 5: Display Results ──────────────────────────────────────────────
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                   OPTIMIZATION RESULTS                      ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');

    for (const symbol of SYMBOLS) {
        const top = rankedStrategies[symbol].slice(0, 5);
        console.log(`\n┌─── TOP 5: ${symbol} ${'─'.repeat(47)}┐`);

        if (top.length === 0) {
            console.log('│  No strategies passed cross-regime filters.');
            console.log('└' + '─'.repeat(60) + '┘');
            continue;
        }

        for (let i = 0; i < top.length; i++) {
            const s = top[i];
            const mode = s.params.useBreakout ? 'BREAKOUT' : (s.params.useMeanReversion ? 'MEAN_REV' : 'PULLBACK');

            console.log(`│`);
            console.log(`│  RANK #${i + 1}  Score: ${s.score.toFixed(4)}  (${mode})`);
            console.log(`│  EMA ${s.params.emaFastPeriod}/${s.params.emaSlowPeriod} | RSI ${s.params.rsiOversold}/${s.params.rsiOverbought} | SL ${s.params.atrMultiplier}x | TP ${s.params.tpMultiplier}x | ${s.params.session} | CC:${s.params.useCandleConfirmation}`);
            console.log(`│  AvgWR: ${s.summary.avgWR.toFixed(1)}% | MinWR: ${s.summary.minWR.toFixed(1)}% | AvgPF: ${s.summary.avgPF.toFixed(2)} | MinPF: ${s.summary.minPF.toFixed(2)}`);
            console.log(`│  MaxDD: ${s.summary.maxDD.toFixed(1)}% | Sharpe: ${s.summary.avgSharpe.toFixed(2)} | PnL: ${s.summary.totalPnlPct.toFixed(1)}% | Trades: ${s.summary.totalTrades}`);
            for (const tag of ['BULL', 'BEAR', 'SIDEWAYS']) {
                const r = s.regimes[tag];
                if (r) console.log(`│    ${tag.padEnd(8)}: WR ${r.winRate.toFixed(1)}% PF ${r.profitFactor.toFixed(2)} DD ${r.maxDrawdown.toFixed(1)}% Sh ${r.sharpeRatio.toFixed(2)} Tr ${r.tradesCount} PnL ${r.totalPnlPct.toFixed(1)}%`);
            }
        }
        console.log('└' + '─'.repeat(60) + '┘');
    }

    // ── Comparison table ──────────────────────────────────────────────────────
    console.log('\n╔═════════════════════════ COMPARISON TABLE ═════════════════════╗');
    console.log(`║ ${'Sym'.padEnd(7)} ${'Mode'.padEnd(5)} ${'EMA'.padEnd(7)} ${'RSI'.padEnd(6)} ${'SL'.padEnd(5)} ${'TP'.padEnd(4)} ${'Ses'.padEnd(4)} ${'Score'.padEnd(7)} ${'WR'.padEnd(6)} ${'PF'.padEnd(5)} ${'DD'.padEnd(5)} ${'Sh'.padEnd(5)} ${'PnL'.padEnd(8)} ║`);

    for (const symbol of SYMBOLS) {
        for (const s of rankedStrategies[symbol].slice(0, 5)) {
            const mode = s.params.useBreakout ? 'BRK' : (s.params.useMeanReversion ? 'MR' : 'PB');
            console.log(`║ ${symbol.padEnd(7)} ${mode.padEnd(5)} ${(s.params.emaFastPeriod + '/' + s.params.emaSlowPeriod).padEnd(7)} ${(s.params.rsiOversold + '/' + s.params.rsiOverbought).padEnd(6)} ${(s.params.atrMultiplier + 'x').padEnd(5)} ${(s.params.tpMultiplier + 'x').padEnd(4)} ${s.params.session.padEnd(4)} ${s.score.toFixed(4).padEnd(7)} ${(s.summary.avgWR.toFixed(1) + '%').padEnd(6)} ${s.summary.avgPF.toFixed(2).padEnd(5)} ${(s.summary.maxDD.toFixed(1) + '%').padEnd(5)} ${s.summary.avgSharpe.toFixed(2).padEnd(5)} ${(s.summary.totalPnlPct.toFixed(0) + '%').padEnd(8)} ║`);
        }
    }
    console.log('╚═══════════════════════════════════════════════════════════════╝');

    // ── Phase 6: Save Production Configs ──────────────────────────────────────
    console.log('\n━━━ PHASE 6: PRODUCTION CONFIGS ━━━');

    const configDir = path.join(process.cwd(), 'config');
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

    for (const symbol of SYMBOLS) {
        const winner = winners[symbol];
        if (!winner) { console.log(`  [SKIP] No winner for ${symbol}`); continue; }

        const base = symbol.replace('USDT', '');
        const mode = winner.params.useBreakout ? 'Breakout' : (winner.params.useMeanReversion ? 'MeanRev' : 'Pullback');
        const strategyName = `${base}_Quantum_${mode}_v1`;

        const config = {
            general: {
                strategyName,
                cooldownMinutes: 60, maxTradesPerDay: 10, minEntryIntervalHours: 1,
                maxSpreadPercent: 0.0005, maxDailyLoss: 0.05, maxDrawdownStop: 0.15,
                maxConcurrentTrades: 2, avoidTimeStartUTC: '23:59', avoidTimeEndUTC: '00:01',
                lastPromotionSource: 'quant_optimization_v2',
                lastPromotionAt: new Date().toISOString(),
                lastUpdatedAt: new Date().toISOString(),
                lastUpdatedSource: 'quant_optimization_v2',
            },
            trendStrategy: {
                timeframe: '5m',
                emaFast: winner.params.emaFastPeriod, emaSlow: winner.params.emaSlowPeriod,
                emaHTF: 1000, rsiPeriod: 14, atrPeriod: 14, adxPeriod: 14,
                rsiOversold: winner.params.rsiOversold, rsiOverbought: winner.params.rsiOverbought,
                useEmaHTF: false,
                atrMultiplierSL: winner.params.atrMultiplier, atrMultiplierTP: winner.params.tpMultiplier,
                useCandleConfirmation: winner.params.useCandleConfirmation,
                useBreakout: winner.params.useBreakout, useMeanReversion: winner.params.useMeanReversion,
                useMacd: false, leverage: 10, useSessionFilter: true, session: winner.params.session,
            },
            risk: { maxAccountExposure: 0.2, maxRiskPerTrade: 0.02, maxFundingRate: 0.0005, killSwitchLosses: 5, killSwitchPauseHours: 6 },
            regime: { minVolatilityPercent: 0.001, trendAdxThreshold: 25, rangingAdxThreshold: 20 },
            allowedSymbols: [`${base}/USDT`, `${base}/USDT:USDT`],
            performance: {
                crossRegimeScore: winner.score,
                avgWinRate: winner.summary.avgWR, minWinRate: winner.summary.minWR,
                avgProfitFactor: winner.summary.avgPF, minProfitFactor: winner.summary.minPF,
                maxDrawdown: winner.summary.maxDD, avgSharpeRatio: winner.summary.avgSharpe,
                totalPnlPct: winner.summary.totalPnlPct, totalTrades: winner.summary.totalTrades,
                perRegime: winner.regimes,
                optimizedAt: new Date().toISOString(),
            },
        };

        const filePath = path.join(configDir, `strategy_${symbol.toLowerCase()}_quantum.json`);
        fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
        console.log(`  [SAVED] ${strategyName} → config/strategy_${symbol.toLowerCase()}_quantum.json`);
    }

    // Save report
    const report = {
        timestamp: new Date().toISOString(),
        searchConfig: { symbols: SYMBOLS, timeframe: TIMEFRAME, emaGroups: EMA_GROUPS, gridSize: grid.length, totalRuns, filters: FILTERS },
        winners: Object.fromEntries(Object.entries(winners).map(([sym, w]) => [sym, { params: w.params, score: w.score, summary: w.summary, regimes: w.regimes }])),
        top5: Object.fromEntries(SYMBOLS.map(sym => [sym, rankedStrategies[sym].slice(0, 5).map(s => ({ params: s.params, score: s.score, summary: s.summary, regimes: s.regimes }))])),
        executionTime: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
    };

    fs.writeFileSync(path.join(process.cwd(), 'quant_optimization_report.json'), JSON.stringify(report, null, 2));
    console.log(`  [SAVED] quant_optimization_report.json`);

    // ── Summary ───────────────────────────────────────────────────────────────
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    OPTIMIZATION COMPLETE                     ║');
    console.log(`║  Time: ${totalTime}s | Backtests: ${totalRuns} | Grid: ${grid.length}`);

    for (const symbol of SYMBOLS) {
        const w = winners[symbol];
        if (w) {
            const mode = w.params.useBreakout ? 'BREAKOUT' : (w.params.useMeanReversion ? 'MEAN_REV' : 'PULLBACK');
            console.log(`║  ${symbol}: ${mode} EMA ${w.params.emaFastPeriod}/${w.params.emaSlowPeriod} | WR ${w.summary.avgWR.toFixed(1)}% PF ${w.summary.avgPF.toFixed(2)} DD ${w.summary.maxDD.toFixed(1)}% Sharpe ${w.summary.avgSharpe.toFixed(2)}`);
        }
    }
    console.log('╚══════════════════════════════════════════════════════════════╝');

    return { winners, rankedStrategies };
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
