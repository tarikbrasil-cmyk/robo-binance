import { runBacktestProgrammatic } from './src/backtestRunner.js';
import { loadStrategyConfig } from './src/strategy/regime_engine.js';

async function testV5() {
    const config = loadStrategyConfig();
    config.activeStrategy = 'V5';
    
    console.log('Running test backtest for V5 Regime-Adaptive Strategy...');
    const result = await runBacktestProgrammatic(
        'BTCUSDT', 
        '2023-10-01', 
        '2023-10-30', 
        1000, 
        config
    );
    
    if (result && result.summary) {
        console.log('V5 Summary:', JSON.stringify(result.summary, null, 2));
    } else {
        console.log('No trades or error occurred.');
    }
}

testV5().catch(console.error);
