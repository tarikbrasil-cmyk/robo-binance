import { loadHistoricalData } from './src/data/historicalLoader.js';

async function debugStructure() {
    const symbol = 'BTCUSDT';
    const start = new Date('2023-11-01').getTime();
    const end = new Date('2023-11-05').getTime();
    const candles = await loadHistoricalData(symbol, '1m', start, end);
    
    console.log(`Analyzing ${candles.length} candles...`);
    
    let counts = { BULLISH_STRUCTURE: 0, BULL_TREND: 0, BEAR_TREND: 0, PULLBACK: 0, PATTERN: 0, RSI: 0, TOTAL_TRIGGER: 0 };
    
    const { calculateIndicators, loadStrategyConfig, detectMarketStructure, detectCandlePattern } = await import('./src/strategy/regime_engine.js');
    const config = loadStrategyConfig();
    const indicators = calculateIndicators(candles, config);

    for(let i = 200; i < candles.length; i++) {
        const structure = detectMarketStructure(candles.slice(0, i+1), 20);
        if (structure === 'BULLISH_STRUCTURE') counts.BULLISH_STRUCTURE++;
        
        const ind = indicators[i];
        if (ind.emaFast > ind.emaSlow) counts.BULL_TREND++;
        if (ind.emaFast < ind.emaSlow) counts.BEAR_TREND++;
        
        const isPullback = Math.abs(candles[i].close - ind.emaFast) < ind.atr * 2.5; // Relaxed to 2.5
        if (isPullback) counts.PULLBACK++;
        
        const pattern = detectCandlePattern(candles[i], candles[i-1]);
        const body = Math.abs(candles[i].close - candles[i].open);
        const isStrongBull = candles[i].close > candles[i].open && body > ind.atr * 0.2; // 0.2 ATR body
        
        if (pattern || isStrongBull) counts.PATTERN++;
        
        const isRsiOk = ind.rsi >= 35 && ind.rsi <= 65; // Relaxed RSI
        if (isRsiOk) counts.RSI++;

        if (structure === 'BULLISH_STRUCTURE' && ind.emaFast > ind.emaSlow && isPullback && (pattern || isStrongBull) && isRsiOk) {
            counts.TOTAL_TRIGGER++;
        }
    }
    
    console.log('Results:', counts);
}

debugStructure();
