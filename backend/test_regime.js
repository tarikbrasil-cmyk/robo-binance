import { detectMarketRegime, loadStrategyConfig } from './src/strategy/regime_engine.js';

const config = loadStrategyConfig();

console.log('--- REGIME DETECTION VERIFICATION ---');
console.log('Config trendAdxThreshold:', config.regime.trendAdxThreshold);
console.log('Config rangingAdxThreshold:', config.regime.rangingAdxThreshold);

const testCases = [
    { adx: 10, name: 'Range Zone', expected: 'RANGE' },
    { adx: 17, name: 'Range Zone Edge', expected: 'RANGE' },
    { adx: 18, name: 'Neutral Zone Bottom', expected: 'NEUTRAL' },
    { adx: 21, name: 'Neutral Zone Mid', expected: 'NEUTRAL' },
    { adx: 25, name: 'Neutral Zone Top', expected: 'NEUTRAL' },
    { adx: 30, name: 'Trend Zone', expected: 'TREND' }
];

testCases.forEach(tc => {
    // Mock indicator
    const indicator = {
        adx: tc.adx,
        ema50: 105,
        ema200: 100, // Distance 5%
        atr: 1,
        atrSma50: 2
    };
    
    const regime = detectMarketRegime(indicator, config);
    console.log(`ADX: ${tc.adx.toString().padEnd(4)} | Zone: ${tc.name.padEnd(20)} | Result: ${regime.padEnd(10)} | ${regime === tc.expected ? '✅' : '❌'}`);
});
