import { runBacktestProgrammatic } from './src/backtestRunner.js';
import { loadStrategyConfig } from './src/strategy/regime_engine.js';

async function testV3() {
    const config = loadStrategyConfig();
    config.activeStrategy = 'V3';
    
    console.log('Running BASELINE backtest for BTCUSDT (V3)...');
    const result = await runBacktestProgrammatic(
        'BTCUSDT', 
        '2023-10-01', 
        '2023-10-15', 
        1000, 
        config
    );
    
    if (result && result.summary) {
        console.log('V3 Summary:', JSON.stringify(result.summary, null, 2));
    } else {
        console.log('No trades or error occurred.');
    }
}

testV3().catch(console.error);
