import { runBacktestProgrammatic } from './src/backtestRunner.js';
import { loadStrategyConfig } from './src/strategy/regime_engine.js';

async function auditV5() {
    const config = loadStrategyConfig();
    config.activeStrategy = 'V5';
    
    console.log('Running AUDIT backtest for V5...');
    const result = await runBacktestProgrammatic(
        'BTCUSDT', 
        '2023-10-01', 
        '2023-10-05', 
        1000, 
        config
    );
    
    if (result && result.trades.length > 0) {
        console.log('First 5 Trades Audit:');
        result.trades.slice(0, 5).forEach((t, i) => {
            console.log(`Trade ${i+1}: ${t.side} | Entry: ${t.entryPrice} | Exit: ${t.exitPrice} | PnL: ${t.pnl} | ROE: ${t.roe} | Elapsed: ${t.candlesElapsed}`);
        });
        console.log('Summary:', result.summary);
    } else {
        console.log('No trades found.');
    }
}

auditV5().catch(console.error);
