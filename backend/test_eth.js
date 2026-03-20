import { runBacktestProgrammatic } from './src/backtestRunner.js';
import { loadStrategyConfig } from './src/strategy/regime_engine.js';

async function testETH() {
    const config = loadStrategyConfig();
    config.activeStrategy = 'INSTITUTIONAL_ALPHA';
    
    console.log('Running robust test for ETHUSDT...');
    const result = await runBacktestProgrammatic(
        'ETHUSDT', 
        '2023-10-01', 
        '2023-10-15', 
        1000, 
        config
    );
    
    if (result && result.summary) {
        console.log('ETH Summary:', JSON.stringify(result.summary, null, 2));
    } else {
        console.log('No trades or error occurred.');
    }
}

testETH().catch(console.error);
