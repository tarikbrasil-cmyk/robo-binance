import { loadHistoricalData } from '../data/historicalLoader.js';
import { calculateIndicators } from '../strategy/regime_engine.js';
import { simulateTrade } from '../execution/simulator.js';
import { evaluateModularStrategyV6 } from '../strategy/ModularStrategyV6.js';

/**
 * Massive Optimization Engine (Grid Search)
 */
export async function runOptimizationSearch(baseConfig, searchSpace) {
    const results = [];
    const symbols = searchSpace.symbols || ['BTCUSDT'];
    const timeframes = searchSpace.timeframes || ['1m', '5m', '15m'];
    
    // 1. DATA PREPARATION (3 Months)
    // We'll use 2023-01-01 to 2023-03-31 as our Search Phase
    const startSearch = new Date('2023-01-01T00:00:00Z').getTime();
    const endSearch = new Date('2023-03-31T23:59:59Z').getTime();

    for (const symbol of symbols) {
        for (const tf of timeframes) {
            console.log(`\n[OPTIMIZER] Loading data for ${symbol} @ ${tf}...`);
            const candles = await loadHistoricalData(symbol, tf, startSearch, endSearch);
            if (candles.length < 100) continue;

            // 2. GENERATE PERMUTATIONS
            const permutations = generatePermutations(searchSpace.params);
            console.log(`[OPTIMIZER] Testing ${permutations.length} combinations for ${symbol} @ ${tf}...`);

            for (const params of permutations) {
                const indicators = calculateIndicators(candles, { 
                    trendStrategy: { 
                        emaFast: params.emaFastPeriod, 
                        emaSlow: params.emaSlowPeriod, 
                        emaHTF: params.emaHTFPeriod,
                        rsiPeriod: params.rsiPeriod,
                        atrPeriod: params.atrPeriod || 14,
                        adxPeriod: params.adxPeriod || 14
                    } 
                });

                const backtestResult = runBacktestInternal(candles, indicators, baseConfig, params, symbol);
                
                if (backtestResult) {
                    console.log(`[TEST] ${symbol} @ ${tf} | WR: ${backtestResult.summary.winRate} | Trades: ${backtestResult.summary.tradesCount} | Mode: ${params.useBreakout ? 'BRK' : (params.useMeanReversion ? 'MR' : 'PB')}`);
                    results.push({
                        symbol,
                        tf,
                        params,
                        metrics: backtestResult.summary
                    });
                }
            }
            // Per-batch feedback
            const batchTop = results
                .filter(r => r.symbol === symbol && r.tf === tf)
                .sort((a,b) => b.metrics.winRateValue - a.metrics.winRateValue)[0];
            if (batchTop) {
                console.log(`[BATCH RESULTS] Best WR for ${symbol} @ ${tf}: ${batchTop.metrics.winRate} (${batchTop.metrics.tradesCount} trades)`);
            }
        }
    }

    // 3. RANK AND FILTER
    const filtered = results
        .sort((a, b) => b.metrics.winRateValue - a.metrics.winRateValue);

    return filtered.slice(0, 50); // Top 50 candidates
}

function runBacktestInternal(candles, indicators, config, optParams, symbol) {
    let balance = 1000;
    const trades = [];
    const initialBalance = balance;
    
    for (let i = 1000; i < candles.length; i++) {
        // Simple simulation loop
        const signal = evaluateModularStrategyV6(candles, indicators, i, optParams, symbol);
        
        if (signal) {
            // Find exit in future candles (Simplified for speed)
            const tradeResult = fastSimulate(candles, i, signal, optParams);
            if (tradeResult) {
                // Fixed sizing: 2% risk/position
                const profit = balance * 0.02 * tradeResult.roe * 10; 
                balance += profit;
                trades.push({ ...tradeResult, pnl: profit });
                i += tradeResult.candlesElapsed;
            }
        }
    }

    const wins = trades.filter(t => t.roe > 0).length;
    const wr = trades.length > 0 ? (wins / trades.length * 100) : 0;

    return {
        trades,
        summary: {
            winRateValue: wr,
            winRate: `${wr.toFixed(2)}%`,
            tradesCount: trades.length,
            profitFactor: calculatePF(trades),
            totalPnl: balance - initialBalance
        }
    };
}

function generatePermutations(fields) {
    const keys = Object.keys(fields);
    const result = [];

    function combine(index, current) {
        if (index === keys.length) {
            result.push({ ...current });
            return;
        }
        const key = keys[index];
        const values = fields[key];
        for (const val of values) {
            current[key] = val;
            combine(index + 1, current);
        }
    }

    combine(0, {});
    return result;
}

function fastSimulate(candles, startIndex, signal, optParams) {
    // Basic TP/SL exit simulation
    const entry = signal.entryPrice;
    const tp = signal.takeProfitPrice;
    const sl = signal.stopLossPrice;
    const side = signal.signal;

    for (let i = startIndex + 1; i < candles.length; i++) {
        const c = candles[i];
        const hitTP = side === 'BUY' ? c.high >= tp : c.low <= tp;
        const hitSL = side === 'BUY' ? c.low <= sl : c.high >= sl;

        if (hitTP && hitSL) return { roe: -0.015, candlesElapsed: i - startIndex }; // Conservador
        if (hitSL) return { roe: -0.015, candlesElapsed: i - startIndex };
        if (hitTP) return { roe: 0.03, candlesElapsed: i - startIndex };

        if (i - startIndex > 240) break; // Max 4h trade
    }
    return null;
}

function calculatePF(trades) {
    const grossProf = trades.filter(t => t.roe > 0).reduce((a, b) => a + b.roe, 0);
    const grossLoss = Math.abs(trades.filter(t => t.roe < 0).reduce((a, b) => a + b.roe, 0));
    return grossLoss === 0 ? grossProf : grossProf / grossLoss;
}
