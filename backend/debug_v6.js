import { loadHistoricalData } from './src/data/historicalLoader.js';
import { calculateIndicators } from './src/strategy/regime_engine.js';
import { evaluateModularStrategyV6 } from './src/strategy/ModularStrategyV6.js';

async function debugV6() {
    const symbol = 'BTCUSDT';
    const tf = '15m';
    const start = new Date('2023-01-01T00:00:00Z').getTime();
    const end = new Date('2023-01-05T00:00:00Z').getTime();
    
    const candles = await loadHistoricalData(symbol, tf, start, end);
    const indicators = calculateIndicators(candles, { 
        trendStrategy: { emaFast: 20, emaSlow: 50, emaHTF: 200 } 
    });
    
    console.log(`Candles: ${candles.length}, Indicators: ${indicators.length}`);
    
    const params = {
        rsiPeriod: 14,
        rsiOversold: 50,
        rsiOverbought: 50,
        emaFastPeriod: 20,
        emaSlowPeriod: 50,
        emaHTFPeriod: 200,
        useEmaHTF: false,
        atrMultiplier: 1.5,
        tpMultiplier: 3.0,
        useSessionFilter: false,
        useBreakout: false,
        useMeanReversion: false,
        useMacd: false
    };

    let signals = 0;
    for (let i = 200; i < candles.length; i++) {
        const signal = evaluateModularStrategyV6(candles, indicators, i, params, symbol);
        if (signal) {
            signals++;
            console.log(`[SIGNAL] idx ${i} | ${signal.signal} @ ${signal.entryPrice}`);
        }
        
        // Debug first 5 steps
        if (i < 205) {
            const ind = indicators[i];
            console.log(`Step ${i}: Price ${candles[i].close} | RSI ${ind.rsi} | Fast ${ind.emaFast} | Slow ${ind.emaSlow} | HTF ${ind.emaHTF}`);
        }
    }
    console.log(`Total Signals: ${signals}`);
}

debugV6().catch(console.error);
