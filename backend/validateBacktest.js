/**
 * validateBacktest.js
 *
 * Runs 3 historical backtests for BTCUSDT and validates that:
 *   - Each period produces ≥ 10 trades (warns at < 5)
 *   - No single trade loses more than 5% of the account
 *   - Prints a summary table with Period, Trades, WinRate, AvgWin, AvgLoss,
 *     ProfitFactor, MaxLossTradePercent
 *
 * Usage:
 *   node validateBacktest.js
 */

import { runBacktestProgrammatic } from './src/backtestRunner.js';

const SYMBOL           = 'BTCUSDT';
const INITIAL_BALANCE  = 1000;
const MAX_LOSS_PCT     = 0.05;    // 5% max per trade
const MIN_TRADES_WARN  = 5;
const MIN_TRADES_VALID = 10;

const PERIODS = [
    { label: '2022-05-01 → 2022-10-15', start: '2022-05-01', end: '2022-10-15' },
    { label: '2023-10-01 → 2023-12-25', start: '2023-10-01', end: '2023-12-25' },
    { label: '2024-04-01 → 2024-06-15', start: '2024-04-01', end: '2024-06-15' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function padEnd(str, len) {
    return String(str).padEnd(len);
}
function padStart(str, len) {
    return String(str).padStart(len);
}

function printTable(rows) {
    const cols = [
        { key: 'period',          label: 'Period',           w: 28 },
        { key: 'trades',          label: 'Trades',           w:  8 },
        { key: 'winRate',         label: 'WinRate',          w: 10 },
        { key: 'avgWin',          label: 'AvgWin',           w: 10 },
        { key: 'avgLoss',         label: 'AvgLoss',          w: 10 },
        { key: 'profitFactor',    label: 'ProfitFactor',     w: 14 },
        { key: 'maxLossTradePct', label: 'MaxLossTrade%',    w: 15 },
        { key: 'status',          label: 'Status',           w: 10 },
    ];

    const div = '+' + cols.map(c => '-'.repeat(c.w + 2)).join('+') + '+';
    const header = '|' + cols.map(c => ' ' + padEnd(c.label, c.w) + ' ').join('|') + '|';

    console.log('\n' + div);
    console.log(header);
    console.log(div);

    for (const row of rows) {
        const line = '|' + cols.map(c => ' ' + padEnd(row[c.key] ?? '', c.w) + ' ').join('|') + '|';
        console.log(line);
    }
    console.log(div + '\n');
}

// ─── Validation Logic ──────────────────────────────────────────────────────────

async function validatePeriod(period) {
    console.log(`\n[validateBacktest] Running: ${period.label}`);

    const { trades, finalBalance } = await runBacktestProgrammatic(
        SYMBOL,
        period.start,
        period.end,
        INITIAL_BALANCE
    );

    if (trades.length < MIN_TRADES_WARN) {
        console.warn(`⚠️  WARNING: Strategy generated too few trades (${trades.length}) for statistical validation in ${period.label}`);
    }

    const pnls    = trades.map(t => parseFloat(t.pnl));
    const balSeq  = [];
    let runBal    = INITIAL_BALANCE;
    const maxLossPct = trades.reduce((worst, t) => {
        const pnl = parseFloat(t.pnl);
        const pct = Math.abs(Math.min(0, pnl)) / runBal;
        runBal += pnl;
        return Math.max(worst, pct);
    }, 0);

    const wins         = pnls.filter(p => p > 0);
    const losses       = pnls.filter(p => p <= 0);
    const grossWin     = wins.reduce((a, b) => a + b, 0);
    const grossLoss    = Math.abs(losses.reduce((a, b) => a + b, 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : Infinity;

    const isValid = maxLossPct <= MAX_LOSS_PCT && trades.length >= MIN_TRADES_VALID;
    const status  = isValid ? '✅ OK' : '❌ FAIL';

    if (maxLossPct > MAX_LOSS_PCT) {
        console.error(`  ❌ Max loss per trade ${(maxLossPct * 100).toFixed(2)}% exceeds ${MAX_LOSS_PCT * 100}% limit in ${period.label}`);
    }
    if (trades.length < MIN_TRADES_VALID) {
        console.warn(`  ⚠️  Only ${trades.length} trades — need at least ${MIN_TRADES_VALID} for statistical validity.`);
    }

    return {
        period:          period.label,
        trades:          trades.length,
        winRate:         trades.length > 0 ? (wins.length / trades.length * 100).toFixed(1) + '%' : 'N/A',
        avgWin:          wins.length   > 0 ? (grossWin  / wins.length).toFixed(2)   : '0',
        avgLoss:         losses.length > 0 ? (-grossLoss / losses.length).toFixed(2) : '0',
        profitFactor:    isFinite(profitFactor) ? profitFactor.toFixed(3) : '∞',
        maxLossTradePct: (maxLossPct * 100).toFixed(2) + '%',
        status,
    };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log('='.repeat(60));
    console.log('  BACKTEST VALIDATION — Risk Engine Audit');
    console.log(`  Symbol: ${SYMBOL} | Balance: ${INITIAL_BALANCE} USDT`);
    console.log(`  Max loss per trade allowed: ${MAX_LOSS_PCT * 100}%`);
    console.log('='.repeat(60));

    const rows = [];
    for (const period of PERIODS) {
        const result = await validatePeriod(period);
        rows.push(result);
    }

    printTable(rows);

    const allPass = rows.every(r => r.status === '✅ OK');
    if (allPass) {
        console.log('✅ All periods PASSED validation. Risk engine is working correctly.\n');
        process.exit(0);
    } else {
        console.error('❌ One or more periods FAILED. Review risk engine settings.\n');
        process.exit(1);
    }
}

main().catch(err => {
    console.error('[validateBacktest] Fatal error:', err.message);
    process.exit(1);
});
