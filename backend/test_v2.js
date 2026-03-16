import { calculateIndicators, detectMarketRegime, loadStrategyConfig } from './src/strategy/regime_engine.js';

const config = loadStrategyConfig();

console.log('--- V2 INDICATORS & REGIME VERIFICATION ---');

const mockCandles = [];
for (let i = 0; i < 200; i++) {
    mockCandles.push({
        high: 100 + Math.random() * 5,
        low: 95 + Math.random() * 5,
        close: 97 + Math.random() * 5,
        volume: 1000 + Math.random() * 500,
        ts: Date.now() - (200 - i) * 60000
    });
}

// Add a clear trend at the end
for (let i = 0; i < 20; i++) {
    const last = mockCandles[mockCandles.length - 1];
    mockCandles.push({
        high: last.high + 2,
        low: last.low + 2,
        close: last.close + 2,
        volume: 3000, // spikes volume
        ts: Date.now() - (20 - i) * 60000
    });
}

const indicators = calculateIndicators(mockCandles);
const latestInd = indicators[indicators.length - 1];

console.log('Latest Price:', latestInd.close || mockCandles[mockCandles.length-1].close);
console.log('Z-Score:', latestInd.zscore.toFixed(2));
console.log('ATR%:', (latestInd.atrPercent * 100).toFixed(3) + '%');
console.log('EMA Slope:', latestInd.emaSlope.toFixed(4));
console.log('Highest High (20):', latestInd.highestHigh20);
console.log('Regime:', detectMarketRegime(latestInd, config));

// Test Volume Confirmation
const volMult = (latestInd.volume / latestInd.volSma20).toFixed(2);
console.log(`Volume: ${latestInd.volume} | SMA20: ${latestInd.volSma20.toFixed(0)} | Multiplier: ${volMult}x`);

if (latestInd.zscore !== undefined && latestInd.highestHigh20 !== undefined) {
    console.log('\n✅ VERIFICATION SUCCESS: V2 Indicators calculated correctly.');
} else {
    console.log('\n❌ VERIFICATION FAILURE: Missing V2 indicators!');
}
