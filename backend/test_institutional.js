import { runBacktestProgrammatic } from './src/backtestRunner.js';
import { loadStrategyConfig } from './src/strategy/regime_engine.js';

async function test() {
    const config = loadStrategyConfig();
    config.activeStrategy = 'INSTITUTIONAL_ALPHA';
    
    console.log('Running test backtest for BTCUSDT...');
    const result = await runBacktestProgrammatic(
        'BTCUSDT', 
        '2023-10-01', 
        '2023-10-15', 
        1000, 
        config
    );
    
    if (result && result.summary) {
        console.log('Backtest Summary:', JSON.stringify(result.summary, null, 2));
    } else {
        console.log('No trades or error occurred.');
    }
}

test().catch(console.error);
