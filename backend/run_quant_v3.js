/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  FAST QUANT OPTIMIZER v3 — Inline Signal Engine
 *  ────────────────────────────────────────────────
 *  Eliminates function call overhead by inlining the signal evaluation.
 *  Pre-builds session-filtered index arrays to skip non-trading candles.
 *  ~10x faster than v1/v2.
 *
 *  Grid: 1,920 combos × 2 symbols × 3 regimes = 11,520 backtests
 *  Expected runtime: ~15-30 minutes
 * ══════════════════════════════════════════════════════════════════════════════
 */
import fs from 'fs';
import path from 'path';
import { hasDiskCache, loadFromDisk, toObjectArray } from './src/benchmark/columnStore.js';
import { downloadDataset } from './src/benchmark/downloader.js';
import { calculateIndicators, loadStrategyConfig } from './src/strategy/regime_engine.js';

const SYMBOLS   = ['BTCUSDT', 'ETHUSDT'];
const TIMEFRAME = '5m';

const REGIMES = [
    { tag: 'BULL',     startMs: new Date('2021-01-01T00:00:00Z').getTime(), endMs: new Date('2021-11-30T23:59:59Z').getTime() },
    { tag: 'BEAR',     startMs: new Date('2022-04-01T00:00:00Z').getTime(), endMs: new Date('2022-12-31T23:59:59Z').getTime() },
    { tag: 'SIDEWAYS', startMs: new Date('2023-01-01T00:00:00Z').getTime(), endMs: new Date('2023-10-31T23:59:59Z').getTime() },
];

const EMA_GROUPS = [
    { emaFast: 20, emaSlow: 100 },
    { emaFast: 20, emaSlow: 200 },
    { emaFast: 50, emaSlow: 200 },
];

const PARAM_GRID = {
    rsiOversold:      [30, 35, 40, 45],
    rsiOverbought:    [55, 60, 65, 70],
    atrMultiplier:    [1.5, 2.0, 2.5, 3.0],
    tpMultiplier:     [1.5, 2.0, 3.0, 4.0],
    mode:             ['pullback', 'breakout', 'meanReversion'],
    session:          ['NY', 'LONDON'],
    useCandleConfirm: [true, false],
};

const INITIAL_BALANCE = 10000;
const RISK_PER_TRADE  = 0.02;

const FILTERS = {
    minTradesPerRegime: 10,
    minWinRate: 38,
    minProfitFactor: 0.9,
    maxDrawdown: 35,
};

// ═══════════════════════════════════════════════════════════════════════════════
//  GRID GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

function generateGrid() {
    const combos = [];
    for (const eg of EMA_GROUPS) {
        const keys = Object.keys(PARAM_GRID);
        function rec(idx, cur) {
            if (idx === keys.length) {
                combos.push({
                    emaFast: eg.emaFast, emaSlow: eg.emaSlow,
                    rsiOversold: cur.rsiOversold, rsiOverbought: cur.rsiOverbought,
                    atrMult: cur.atrMultiplier, tpMult: cur.tpMultiplier,
                    mode: cur.mode, session: cur.session, cc: cur.useCandleConfirm,
                });
                return;
            }
            for (const v of PARAM_GRID[keys[idx]]) { cur[keys[idx]] = v; rec(idx + 1, cur); }
        }
        rec(0, {});
    }
    return combos;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PRE-BUILD SESSION INDICES
// ═══════════════════════════════════════════════════════════════════════════════

function buildSessionIndices(candles) {
    const nyIdx = [], lonIdx = [];
    for (let i = 0; i < candles.length; i++) {
        const h = new Date(candles[i].ts).getUTCHours();
        if (h >= 13 && h < 21) nyIdx.push(i);
        if (h >= 8 && h < 16) lonIdx.push(i);
    }
    return { NY: nyIdx, LONDON: lonIdx };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INLINE FAST BACKTEST
// ═══════════════════════════════════════════════════════════════════════════════

function fastBacktest(candles, indicators, sessionIndices, params) {
    let balance = INITIAL_BALANCE;
    const initialBal = balance;
    let peakBalance = balance;
    let maxDrawdown = 0;
    let wins = 0, losses = 0;
    let grossProfit = 0, grossLoss = 0;
    const dailyReturns = [];
    let lastDayBal = balance;
    let lastDay = -1;

    const warmup = Math.max(250, params.emaSlow);
    const indices = sessionIndices[params.session];
    const isBreakout = params.mode === 'breakout';
    const isMeanRev = params.mode === 'meanReversion';
    const isPullback = !isBreakout && !isMeanRev;

    // Binary search to find first index >= warmup
    let startIdx = 0;
    while (startIdx < indices.length && indices[startIdx] < warmup) startIdx++;

    let cooldownUntilCandle = 0;

    for (let ii = startIdx; ii < indices.length; ii++) {
        const i = indices[ii];
        if (i < cooldownUntilCandle) continue;

        const ind = indicators[i];
        const indPrev = indicators[i - 1];
        const c = candles[i];
        const cPrev = candles[i - 1];

        if (!ind || !indPrev || !cPrev) continue;
        if (ind.rsi === null || ind.emaFast === null || ind.emaSlow === null || ind.atr === null) continue;

        // Track daily returns
        const day = Math.floor(c.ts / 86400000);
        if (lastDay >= 0 && day !== lastDay) {
            dailyReturns.push((balance - lastDayBal) / lastDayBal);
            lastDayBal = balance;
        }
        lastDay = day;

        // Trend bias
        const trendUp = ind.emaFast > ind.emaSlow;
        const trendDown = ind.emaFast < ind.emaSlow;

        // Signal detection (inlined)
        let signal = null;

        if (trendUp) {
            if (isBreakout && ind.highestHigh20 !== null && c.close > ind.highestHigh20) {
                signal = 'BUY';
            } else if (isPullback && ind.rsi <= params.rsiOversold + 10) {
                if (!params.cc || (c.close > c.open && c.close > cPrev.high && c.close > ind.emaFast)) {
                    signal = 'BUY';
                }
            } else if (isMeanRev && ind.bb && ind.rsi < 30 && c.low < ind.bb.lower) {
                if (!params.cc || (c.close > c.open && c.close > cPrev.high && c.close > ind.emaFast)) {
                    signal = 'BUY';
                }
            }
        } else if (trendDown) {
            if (isBreakout && ind.lowestLow20 !== null && c.close < ind.lowestLow20) {
                signal = 'SELL';
            } else if (isPullback && ind.rsi >= params.rsiOverbought - 10) {
                if (!params.cc || (c.close < c.open && c.close < cPrev.low && c.close < ind.emaFast)) {
                    signal = 'SELL';
                }
            } else if (isMeanRev && ind.bb && ind.rsi > 70 && c.high > ind.bb.upper) {
                if (!params.cc || (c.close < c.open && c.close < cPrev.low && c.close < ind.emaFast)) {
                    signal = 'SELL';
                }
            }
        }

        if (!signal) continue;

        // Calculate levels
        const slDist = ind.atr * params.atrMult;
        const tpDist = ind.atr * params.tpMult;
        const entry = c.close;
        const tp = signal === 'BUY' ? entry + tpDist : entry - tpDist;
        const sl = signal === 'BUY' ? entry - slDist : entry + slDist;
        if (slDist === 0) continue;
        const rr = tpDist / slDist;

        // Forward-scan for TP/SL
        let hit = false;
        for (let j = i + 1; j < candles.length && j - i <= 288; j++) {
            const fwd = candles[j];
            const hitTP = signal === 'BUY' ? fwd.high >= tp : fwd.low <= tp;
            const hitSL = signal === 'BUY' ? fwd.low <= sl  : fwd.high >= sl;

            if (hitTP && hitSL) {
                // Conservative: SL first
                const pnl = -balance * RISK_PER_TRADE;
                balance += pnl;
                losses++;
                grossLoss += Math.abs(pnl);
                cooldownUntilCandle = j + 12;
                hit = true;
                break;
            }
            if (hitSL) {
                const pnl = -balance * RISK_PER_TRADE;
                balance += pnl;
                losses++;
                grossLoss += Math.abs(pnl);
                cooldownUntilCandle = j + 12;
                hit = true;
                break;
            }
            if (hitTP) {
                const pnl = balance * RISK_PER_TRADE * rr;
                balance += pnl;
                wins++;
                grossProfit += pnl;
                cooldownUntilCandle = j + 12;
                hit = true;
                break;
            }
        }

        if (hit) {
            peakBalance = Math.max(peakBalance, balance);
            if (peakBalance > 0) maxDrawdown = Math.max(maxDrawdown, (peakBalance - balance) / peakBalance);
        }
    }

    // Final daily return
    if (balance !== lastDayBal && lastDayBal > 0) {
        dailyReturns.push((balance - lastDayBal) / lastDayBal);
    }

    const total = wins + losses;
    const wr = total > 0 ? (wins / total) * 100 : 0;
    const pf = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99 : 0);

    const avgRet = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
    const stdRet = dailyReturns.length > 1
        ? Math.sqrt(dailyReturns.reduce((a, b) => a + Math.pow(b - avgRet, 2), 0) / (dailyReturns.length - 1))
        : 1;
    const sharpe = stdRet > 0 ? (avgRet / stdRet) * Math.sqrt(365) : 0;

    return {
        tradesCount: total, winRate: wr, profitFactor: pf,
        totalPnl: balance - initialBal,
        totalPnlPct: ((balance - initialBal) / initialBal) * 100,
        maxDrawdown: maxDrawdown * 100,
        finalBalance: balance, sharpeRatio: sharpe,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SCORING
// ═══════════════════════════════════════════════════════════════════════════════

function pk(p) {
    return `${p.emaFast}_${p.emaSlow}_${p.rsiOversold}_${p.rsiOverbought}_${p.atrMult}_${p.tpMult}_${p.mode}_${p.session}_${p.cc}`;
}

function crossScore(regimes) {
    const tags = Object.keys(regimes);
    if (tags.length < 3) return -Infinity;

    const wrs = tags.map(t => regimes[t].winRate);
    const pfs = tags.map(t => regimes[t].profitFactor);
    const dds = tags.map(t => regimes[t].maxDrawdown);
    const shs = tags.map(t => regimes[t].sharpeRatio);
    const trs = tags.map(t => regimes[t].tradesCount);

    const minWR = Math.min(...wrs), minPF = Math.min(...pfs);
    const maxDD = Math.max(...dds), minTr = Math.min(...trs);
    const avgSh = shs.reduce((a, b) => a + b) / shs.length;
    const consistency = Math.min(...wrs) / Math.max(...wrs);

    if (minTr < FILTERS.minTradesPerRegime || minWR < FILTERS.minWinRate || minPF < FILTERS.minProfitFactor || maxDD > FILTERS.maxDrawdown) return -Infinity;

    return (minWR / 100) * 0.25 + Math.min(minPF / 3, 1) * 0.25 + Math.min(Math.max(avgSh, 0) / 2, 1) * 0.20 + consistency * 0.15 - (maxDD / 100) * 0.15;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
    const t0 = Date.now();
    const baseCfg = (() => { try { return loadStrategyConfig(); } catch { return {}; } })();
    const grid = generateGrid();

    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     QUANT OPTIMIZER v3 (Inline Engine)                      ║');
    console.log(`║  Grid: ${grid.length} combos × ${SYMBOLS.length} symbols × ${REGIMES.length} regimes = ${grid.length * SYMBOLS.length * REGIMES.length} runs`);
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    // Phase 1: Load data
    console.log('━━━ DATA ━━━');
    const datasets = {}; // symbol → regime.tag → { candles, indicatorsByEma, sessionIdx }

    for (const symbol of SYMBOLS) {
        datasets[symbol] = {};
        for (const regime of REGIMES) {
            if (hasDiskCache(symbol, TIMEFRAME, regime.tag)) {
                loadFromDisk(symbol, TIMEFRAME, regime.tag);
            } else {
                await downloadDataset(symbol, TIMEFRAME, regime.startMs, regime.endMs, regime.tag);
            }
            const raw = toObjectArray(symbol, TIMEFRAME);
            const candles = raw.filter(c => c.ts >= regime.startMs && c.ts <= regime.endMs);

            if (candles.length < 300) { console.log(`  [SKIP] ${symbol} ${regime.tag}: ${candles.length} candles`); continue; }

            const sessionIdx = buildSessionIndices(candles);
            const indicatorsByEma = {};
            for (const eg of EMA_GROUPS) {
                const key = `${eg.emaFast}_${eg.emaSlow}`;
                indicatorsByEma[key] = calculateIndicators(candles, {
                    ...baseCfg,
                    trendStrategy: { ...(baseCfg.trendStrategy || {}), emaFast: eg.emaFast, emaSlow: eg.emaSlow, emaHTF: 1000, rsiPeriod: 14, atrPeriod: 14, adxPeriod: 14 },
                });
            }
            datasets[symbol][regime.tag] = { candles, indicatorsByEma, sessionIdx };
            console.log(`  [OK] ${symbol} ${regime.tag}: ${candles.length} candles, NY=${sessionIdx.NY.length} LON=${sessionIdx.LONDON.length}`);
        }
    }
    console.log();

    // Phase 2: Grid Search
    console.log('━━━ GRID SEARCH ━━━');
    const allResults = {};
    let done = 0;
    const total = grid.length * SYMBOLS.length * REGIMES.length;

    for (const symbol of SYMBOLS) {
        allResults[symbol] = {};

        for (const regime of REGIMES) {
            const ds = datasets[symbol]?.[regime.tag];
            if (!ds) { done += grid.length; continue; }

            for (const params of grid) {
                const emaKey = `${params.emaFast}_${params.emaSlow}`;
                const indicators = ds.indicatorsByEma[emaKey];
                if (!indicators) { done++; continue; }

                const m = fastBacktest(ds.candles, indicators, ds.sessionIdx, params);
                done++;

                const k = pk(params);
                if (!allResults[symbol][k]) allResults[symbol][k] = { params, regimes: {} };
                allResults[symbol][k].regimes[regime.tag] = m;

                if (done % 500 === 0) {
                    const pct = ((done / total) * 100).toFixed(1);
                    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
                    console.log(`  [${done}/${total}] ${pct}% | ${elapsed}s`);
                }
            }
        }
    }

    const searchTime = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n  Completed ${total} backtests in ${searchTime}s\n`);

    // Phase 3: Score
    console.log('━━━ SCORING ━━━');
    const ranked = {};
    const winners = {};

    for (const symbol of SYMBOLS) {
        const cands = [];
        for (const [, entry] of Object.entries(allResults[symbol])) {
            const sc = crossScore(entry.regimes);
            if (sc > -Infinity) {
                const tags = Object.keys(entry.regimes);
                cands.push({
                    symbol, params: entry.params, regimes: entry.regimes, score: sc,
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
        cands.sort((a, b) => b.score - a.score);
        ranked[symbol] = cands;
        if (cands.length > 0) winners[symbol] = cands[0];
        console.log(`  ${symbol}: ${cands.length} qualified`);
    }
    console.log();

    // Phase 4: Display
    for (const symbol of SYMBOLS) {
        const top = ranked[symbol].slice(0, 5);
        console.log(`┌─── TOP 5: ${symbol} ${'─'.repeat(47)}┐`);
        if (top.length === 0) { console.log('│  None passed filters'); console.log('└' + '─'.repeat(60) + '┘'); continue; }

        for (let i = 0; i < top.length; i++) {
            const s = top[i];
            console.log(`│ #${i+1} ${s.params.mode.toUpperCase().padEnd(12)} Score=${s.score.toFixed(4)}`);
            console.log(`│    EMA ${s.params.emaFast}/${s.params.emaSlow} RSI ${s.params.rsiOversold}/${s.params.rsiOverbought} SL ${s.params.atrMult}x TP ${s.params.tpMult}x ${s.params.session} CC:${s.params.cc}`);
            console.log(`│    AvgWR ${s.summary.avgWR.toFixed(1)}% MinWR ${s.summary.minWR.toFixed(1)}% PF ${s.summary.avgPF.toFixed(2)} DD ${s.summary.maxDD.toFixed(1)}% Sh ${s.summary.avgSharpe.toFixed(2)} PnL ${s.summary.totalPnlPct.toFixed(0)}% Tr ${s.summary.totalTrades}`);
            for (const t of ['BULL', 'BEAR', 'SIDEWAYS']) {
                const r = s.regimes[t]; if (r) console.log(`│    ${t.padEnd(8)} WR ${r.winRate.toFixed(1)}% PF ${r.profitFactor.toFixed(2)} DD ${r.maxDrawdown.toFixed(1)}% Sh ${r.sharpeRatio.toFixed(2)} Tr ${r.tradesCount} PnL ${r.totalPnlPct.toFixed(1)}%`);
            }
        }
        console.log('└' + '─'.repeat(60) + '┘\n');
    }

    // Save configs
    console.log('━━━ SAVING CONFIGS ━━━');
    const configDir = path.join(process.cwd(), 'config');
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

    for (const symbol of SYMBOLS) {
        const w = winners[symbol];
        if (!w) continue;
        const base = symbol.replace('USDT', '');
        const modeLabel = w.params.mode === 'breakout' ? 'Breakout' : (w.params.mode === 'meanReversion' ? 'MeanRev' : 'Pullback');
        const name = `${base}_Quantum_${modeLabel}_v1`;

        const cfg = {
            general: {
                strategyName: name, cooldownMinutes: 60, maxTradesPerDay: 10, minEntryIntervalHours: 1,
                maxSpreadPercent: 0.0005, maxDailyLoss: 0.05, maxDrawdownStop: 0.15, maxConcurrentTrades: 2,
                lastPromotionSource: 'quant_v3', lastPromotionAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString(),
            },
            trendStrategy: {
                timeframe: '5m', emaFast: w.params.emaFast, emaSlow: w.params.emaSlow, emaHTF: 1000,
                rsiPeriod: 14, atrPeriod: 14, adxPeriod: 14,
                rsiOversold: w.params.rsiOversold, rsiOverbought: w.params.rsiOverbought,
                useEmaHTF: false, atrMultiplierSL: w.params.atrMult, atrMultiplierTP: w.params.tpMult,
                useCandleConfirmation: w.params.cc,
                useBreakout: w.params.mode === 'breakout', useMeanReversion: w.params.mode === 'meanReversion',
                useMacd: false, leverage: 10, useSessionFilter: true, session: w.params.session,
            },
            risk: { maxAccountExposure: 0.2, maxRiskPerTrade: 0.02, maxFundingRate: 0.0005, killSwitchLosses: 5, killSwitchPauseHours: 6 },
            regime: { minVolatilityPercent: 0.001, trendAdxThreshold: 25, rangingAdxThreshold: 20 },
            allowedSymbols: [`${base}/USDT`, `${base}/USDT:USDT`],
            performance: {
                crossRegimeScore: w.score, avgWinRate: w.summary.avgWR, minWinRate: w.summary.minWR,
                avgProfitFactor: w.summary.avgPF, minProfitFactor: w.summary.minPF,
                maxDrawdown: w.summary.maxDD, avgSharpeRatio: w.summary.avgSharpe,
                totalPnlPct: w.summary.totalPnlPct, totalTrades: w.summary.totalTrades,
                perRegime: w.regimes, optimizedAt: new Date().toISOString(),
            },
        };

        fs.writeFileSync(path.join(configDir, `strategy_${symbol.toLowerCase()}_quantum.json`), JSON.stringify(cfg, null, 2));
        console.log(`  [SAVED] ${name}`);
    }

    // Save report
    const report = {
        timestamp: new Date().toISOString(),
        searchConfig: { symbols: SYMBOLS, timeframe: TIMEFRAME, gridSize: grid.length, totalRuns: total, filters: FILTERS },
        winners: Object.fromEntries(Object.entries(winners).map(([s, w]) => [s, { params: w.params, score: w.score, summary: w.summary, regimes: w.regimes }])),
        top5: Object.fromEntries(SYMBOLS.map(s => [s, ranked[s].slice(0, 5).map(c => ({ params: c.params, score: c.score, summary: c.summary, regimes: c.regimes }))])),
        executionTime: `${((Date.now() - t0) / 1000).toFixed(1)}s`,
    };
    fs.writeFileSync(path.join(process.cwd(), 'quant_optimization_report.json'), JSON.stringify(report, null, 2));
    console.log('  [SAVED] quant_optimization_report.json');

    // Summary
    const totalTime = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n${'═'.repeat(62)}`);
    console.log(`  DONE in ${totalTime}s | ${total} backtests`);
    for (const s of SYMBOLS) {
        const w = winners[s];
        if (w) console.log(`  ${s}: ${w.params.mode.toUpperCase()} EMA ${w.params.emaFast}/${w.params.emaSlow} | WR ${w.summary.avgWR.toFixed(1)}% PF ${w.summary.avgPF.toFixed(2)} DD ${w.summary.maxDD.toFixed(1)}% Sh ${w.summary.avgSharpe.toFixed(2)}`);
    }
    console.log('═'.repeat(62));
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
