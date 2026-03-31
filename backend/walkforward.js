/**
 * CLI entry point for Walk-Forward Optimization.
 *
 * Usage:
 *   node walkforward.js [SYMBOL] [START_ISO] [END_ISO]
 *
 * Examples:
 *   node walkforward.js BTCUSDT 2024-01-01 2024-06-30
 *   node walkforward.js ETHUSDT 2023-07-01 2024-03-31
 *   npm run walkforward -- SOLUSDT 2024-01-01 2024-12-31
 *
 * Defaults (no args):
 *   BTCUSDT from 12 months ago until yesterday
 */

import 'dotenv/config';
import { runWalkForward } from './src/backtest/walkforward_engine.js';

const [,, symbolArg, startArg, endArg] = process.argv;

const symbol = symbolArg?.toUpperCase() || 'BTCUSDT';

const end   = endArg
    ? new Date(endArg)
    : (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; })();

const start = startArg
    ? new Date(startArg)
    : (() => { const d = new Date(end); d.setFullYear(d.getFullYear() - 1); return d; })();

if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    console.error('❌ Data inválida. Use formato ISO: YYYY-MM-DD');
    process.exit(1);
}

if (end <= start) {
    console.error('❌ END deve ser posterior a START.');
    process.exit(1);
}

console.log(`\n▶  Walk-Forward: ${symbol}  |  ${start.toISOString().slice(0,10)} → ${end.toISOString().slice(0,10)}\n`);

runWalkForward(symbol, start.getTime(), end.getTime())
    .then(report => {
        if (!report) process.exit(1);
        process.exit(report.summary.robust ? 0 : 1);
    })
    .catch(err => {
        console.error('[WFO] Erro fatal:', err.message);
        process.exit(1);
    });
