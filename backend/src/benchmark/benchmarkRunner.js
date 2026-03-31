/**
 * BenchmarkRunner — Runs strategy grid × regime matrix.
 *
 * Uses ColumnStore (Float64Array) data, converts to object arrays only once
 * per (symbol, timeframe, regime) combo, pre-computes indicators once,
 * then iterates all parameter permutations against the same indicator set.
 *
 * This is the inner hot loop — designed for 1000+ strategy variations.
 */
import { getData, toObjectArray, loadFromDisk, hasDiskCache } from './columnStore.js';
import { downloadDataset } from './downloader.js';
import { validateDataset } from './validator.js';
import { calculateIndicators, loadStrategyConfig } from '../strategy/regime_engine.js';
import { evaluateModularStrategyV6, getModularStrategyName } from '../strategy/ModularStrategyV6.js';

// ── Regime Definitions (fixed) ───────────────────────────────────────────────
export const REGIMES = [
    { tag: 'BULL',     label: 'Bull Market',     startMs: new Date('2021-01-01T00:00:00Z').getTime(), endMs: new Date('2021-11-30T23:59:59Z').getTime() },
    { tag: 'BEAR',     label: 'Bear Market',     startMs: new Date('2022-04-01T00:00:00Z').getTime(), endMs: new Date('2022-12-31T23:59:59Z').getTime() },
    { tag: 'SIDEWAYS', label: 'Sideways Market',  startMs: new Date('2023-01-01T00:00:00Z').getTime(), endMs: new Date('2023-10-31T23:59:59Z').getTime() },
];

export const SYMBOLS    = ['BTCUSDT', 'ETHUSDT'];
export const TIMEFRAMES = ['1m', '5m', '15m', '1h'];

// ── Default Parameter Grid ───────────────────────────────────────────────────
export const DEFAULT_GRID = {
    rsiOversold:      [35, 45],
    rsiOverbought:    [55, 65],
    emaFastPeriod:    [20, 50],
    emaSlowPeriod:    [100, 200],
    atrMultiplier:    [2.5, 3.5],
    tpMultiplier:     [1.5, 3.0],
    useBreakout:      [false, true],
    useMeanReversion: [false],
    session:          ['NY', 'LONDON'],
    useSessionFilter: [true],
};

// ── Grid Generation ──────────────────────────────────────────────────────────
function generateGrid(space) {
    const keys = Object.keys(space);
    const grid = [];
    function recurse(idx, current) {
        if (idx === keys.length) { grid.push({ ...current }); return; }
        for (const v of space[keys[idx]]) {
            current[keys[idx]] = v;
            recurse(idx + 1, current);
        }
    }
    recurse(0, {});
    return grid;
}

// ── Fast Backtest (same logic as OptimizationEngine.runBacktestInternal) ────
function fastBacktest(candles, indicators, params, symbol) {
    let balance        = 1000;
    const initialBal   = balance;
    let peakBalance    = balance;
    let maxDrawdown    = 0;
    const trades       = [];
    const warmup       = Math.max(200, params.emaSlowPeriod || 0, params.emaHTFPeriod || 0, 20);

    for (let i = warmup; i < candles.length; i++) {
        const signal = evaluateModularStrategyV6(candles, indicators, i, params, symbol);
        if (!signal) continue;

        // Fast TP/SL simulation
        const entry = signal.entryPrice;
        const tp    = signal.takeProfitPrice;
        const sl    = signal.stopLossPrice;
        const side  = signal.signal;
        let result  = null;

        for (let j = i + 1; j < candles.length && j - i <= 240; j++) {
            const c = candles[j];
            const hitTP = side === 'BUY' ? c.high >= tp : c.low <= tp;
            const hitSL = side === 'BUY' ? c.low <= sl  : c.high >= sl;

            if (hitTP && hitSL) { result = { roe: -0.015, elapsed: j - i }; break; }
            if (hitSL)          { result = { roe: -0.015, elapsed: j - i }; break; }
            if (hitTP)          { result = { roe: 0.03,   elapsed: j - i }; break; }
        }

        if (result) {
            const pnl = balance * 0.02 * result.roe * 10;
            balance += pnl;
            trades.push(result.roe);
            peakBalance = Math.max(peakBalance, balance);
            if (peakBalance > 0) maxDrawdown = Math.max(maxDrawdown, (peakBalance - balance) / peakBalance);
            i += result.elapsed;
        }
    }

    const wins = trades.filter(r => r > 0).length;
    const wr   = trades.length > 0 ? (wins / trades.length) * 100 : 0;
    const grossProfit = trades.filter(r => r > 0).reduce((a, b) => a + b, 0);
    const grossLoss   = Math.abs(trades.filter(r => r < 0).reduce((a, b) => a + b, 0));
    const pf          = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99 : 0);

    return {
        tradesCount:  trades.length,
        winRate:      wr,
        profitFactor: pf,
        totalPnl:     balance - initialBal,
        maxDrawdown:  maxDrawdown * 100,
        finalBalance: balance,
    };
}

// ── Main Benchmark Entry Point ────────────────────────────────────────────────

/**
 * runBenchmark — Download data (if needed), validate, then run all strategy
 * combos across all regimes.
 *
 * @param {Object}   [options]
 * @param {string[]} [options.symbols]    - default SYMBOLS
 * @param {string[]} [options.timeframes] - default TIMEFRAMES
 * @param {Object}   [options.grid]       - default DEFAULT_GRID
 * @param {Function} [options.onProgress] - (phase, detail) callback
 * @returns {Object} full benchmark report
 */
export async function runBenchmark(options = {}) {
    const symbols    = options.symbols    || SYMBOLS;
    const timeframes = options.timeframes || TIMEFRAMES;
    const gridSpace  = options.grid       || DEFAULT_GRID;
    const onProgress = options.onProgress || (() => {});
    const selectedRegimes = options.regimes
        ? REGIMES.filter(r => options.regimes.includes(r.tag))
        : REGIMES;

    const baseConfig = (() => { try { return loadStrategyConfig(); } catch { return {}; } })();
    const grid       = generateGrid(gridSpace);

    onProgress('init', { regimes: selectedRegimes.length, symbols: symbols.length, timeframes: timeframes.length, combinations: grid.length });
    console.log(`[BENCHMARK] Grid: ${grid.length} combos × ${selectedRegimes.length} regimes × ${symbols.length} symbols × ${timeframes.length} TFs`);

    // ── Phase 1: Download / Load data ────────────────────────────────────────
    onProgress('download', { status: 'starting' });
    for (const regime of selectedRegimes) {
        for (const symbol of symbols) {
            for (const tf of timeframes) {
                const tag = `${regime.tag}`;
                if (hasDiskCache(symbol, tf, tag)) {
                    loadFromDisk(symbol, tf, tag);
                } else {
                    await downloadDataset(symbol, tf, regime.startMs, regime.endMs, tag);
                }
            }
        }
    }
    onProgress('download', { status: 'done' });

    // ── Phase 2: Validate ────────────────────────────────────────────────────
    const validationResults = [];
    for (const symbol of symbols) {
        for (const tf of timeframes) {
            validationResults.push({ symbol, timeframe: tf, ...validateDataset(symbol, tf) });
        }
    }
    onProgress('validate', { results: validationResults });

    // ── Phase 3: Run benchmark matrix ────────────────────────────────────────
    const results  = [];
    let completed  = 0;
    const totalRuns = selectedRegimes.length * symbols.length * timeframes.length * grid.length;

    for (const regime of selectedRegimes) {
        for (const symbol of symbols) {
            for (const tf of timeframes) {
                // Load from cache into memory (should already be there)
                const tag = regime.tag;
                if (!getData(symbol, tf)) {
                    loadFromDisk(symbol, tf, tag);
                }

                // Convert to object arrays ONCE for indicator calc
                const candles = toObjectArray(symbol, tf);
                if (candles.length < 300) {
                    console.warn(`[BENCHMARK] Skipping ${symbol} ${tf} ${regime.tag}: only ${candles.length} candles`);
                    completed += grid.length;
                    continue;
                }

                // Calculate indicators ONCE
                const indicators = calculateIndicators(candles, {
                    ...baseConfig,
                    trendStrategy: {
                        ...(baseConfig.trendStrategy || {}),
                        emaFast: 50,
                        emaSlow: 200,
                        emaHTF: 1000,
                        rsiPeriod: 14,
                        atrPeriod: 14,
                        adxPeriod: 14,
                    },
                });

                // Run all grid combos against this dataset
                for (const params of grid) {
                    const metrics = fastBacktest(candles, indicators, params, symbol);
                    completed++;

                    if (metrics.tradesCount >= 5) {
                        const composite = (metrics.winRate / 100) * 0.5
                                        + Math.min(metrics.profitFactor / 5, 1) * 0.3
                                        - (metrics.maxDrawdown / 100) * 0.2;

                        results.push({
                            regime:   regime.tag,
                            symbol,
                            timeframe: tf,
                            params,
                            strategy: getModularStrategyName(params),
                            metrics,
                            composite,
                        });
                    }

                    if (completed % 100 === 0) {
                        onProgress('running', { completed, total: totalRuns, pct: ((completed / totalRuns) * 100).toFixed(1) });
                    }
                }
            }
        }
    }

    // ── Phase 4: Rank results ─────────────────────────────────────────────────
    results.sort((a, b) => b.composite - a.composite);

    const report = {
        timestamp:  new Date().toISOString(),
        config:     { symbols, timeframes, regimes: selectedRegimes.map(r => r.tag), gridSize: grid.length },
        totalRuns,
        qualified:  results.length,
        top50:      results.slice(0, 50),
        byRegime:   {},
        validation: validationResults,
    };

    for (const regime of selectedRegimes) {
        report.byRegime[regime.tag] = results
            .filter(r => r.regime === regime.tag)
            .slice(0, 20);
    }

    onProgress('done', { totalRuns, qualified: results.length });
    console.log(`[BENCHMARK] Done: ${totalRuns} runs, ${results.length} qualified (≥5 trades)`);

    return report;
}
