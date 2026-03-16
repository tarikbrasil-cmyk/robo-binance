import { runWalkForward } from './src/backtest/walkforward_engine.js';

// Jan 2024 to mid Feb 2024 (45 days)
const start = new Date('2024-01-01T00:00:00Z').getTime();
const end = new Date('2024-02-15T23:59:59Z').getTime();

runWalkForward('BTCUSDT', start, end).catch(e => {
    console.error("WFO Error: ", e);
});
