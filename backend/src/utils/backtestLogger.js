import fs from 'fs';
import path from 'path';
import { Parser } from 'json2csv';

/**
 * CSV columns for trade audit log.
 * Order determines column order in the output file.
 */
const TRADE_CSV_FIELDS = [
    'symbol',
    'side',
    'strategy',
    'regime',
    'ts',
    'exitTime',
    'candlesElapsed',
    'entryPrice',
    'exitPrice',
    'stopPrice',
    'takeProfitPrice',
    'roe',
    'pnl',
    'newBalance',
    // ── Risk audit ──
    'accountBalance',
    'riskPerTrade',
    'finalRiskPct',
    'riskAmountUSDT',
    'positionSizeUSDT',
    'positionSizeContracts',
    'stopDistance',
    'stopDistancePercent',
    'expectedLossUSDT',
    'leverageUsed',
    // ── Diagnostics ──
    'kellyFractionApplied',
    'volatilityFactor',
    'stopDistanceClipped',
    'positionClippedByLeverageCap',
];

/**
 * Flatten a trade result (which has riskData nested) into a flat object
 * suitable for CSV serialisation.
 */
function flattenTrade(trade) {
    const r = trade.riskData ?? {};
    return {
        symbol:                     trade.symbol,
        side:                       trade.side,
        strategy:                   trade.strategy,
        regime:                     trade.regime,
        ts:                         trade.ts,
        exitTime:                   trade.exitTime,
        candlesElapsed:             trade.candlesElapsed,
        entryPrice:                 trade.entryPrice,
        exitPrice:                  trade.exitPrice,
        stopPrice:                  trade.stopPrice ?? '',
        takeProfitPrice:            trade.takeProfitPrice ?? '',
        roe:                        trade.roe,
        pnl:                        trade.pnl,
        newBalance:                 trade.newBalance,
        // risk fields
        accountBalance:             r.accountBalance ?? '',
        riskPerTrade:               r.riskPerTrade ?? '',
        finalRiskPct:               r.finalRiskPct ?? '',
        riskAmountUSDT:             r.riskAmountUSDT != null ? r.riskAmountUSDT.toFixed(4) : '',
        positionSizeUSDT:           r.positionSizeUSDT != null ? r.positionSizeUSDT.toFixed(4) : '',
        positionSizeContracts:      r.positionSizeContracts != null ? r.positionSizeContracts.toFixed(8) : '',
        stopDistance:               r.stopDistance != null ? r.stopDistance.toFixed(4) : '',
        stopDistancePercent:        r.stopDistancePercent != null ? (r.stopDistancePercent * 100).toFixed(4) + '%' : '',
        expectedLossUSDT:           r.expectedLossUSDT != null ? r.expectedLossUSDT.toFixed(4) : '',
        leverageUsed:               r.leverageUsed ?? '',
        kellyFractionApplied:       r.kellyFractionApplied != null ? r.kellyFractionApplied.toFixed(4) : '',
        volatilityFactor:           r.volatilityFactor != null ? r.volatilityFactor.toFixed(4) : '',
        stopDistanceClipped:        r.stopDistanceClipped ?? false,
        positionClippedByLeverageCap: r.positionClippedByLeverageCap ?? false,
    };
}

/**
 * Saves trade results as JSON and CSV.
 * @param {Array} trades - Array of trade result objects
 * @param {string} csvPath - Output CSV file path
 * @param {string} jsonPath - Output JSON file path
 */
export function logBacktestResult(trades, csvPath, jsonPath) {
    try {
        // Save JSON (raw, unflattened)
        fs.writeFileSync(jsonPath, JSON.stringify(trades, null, 2));

        // Save CSV (flat, all audit columns)
        if (trades.length > 0) {
            const flatTrades = trades.map(flattenTrade);
            const parser = new Parser({ fields: TRADE_CSV_FIELDS });
            const csv = parser.parse(flatTrades);
            fs.writeFileSync(csvPath, csv);
        }
    } catch (error) {
        console.error('[backtestLogger] Erro ao salvar logs de trades:', error.message);
    }
}

/**
 * Saves per-candle debug entries as NDJSON (newline-delimited JSON).
 * Each line is one candle's decision record.
 *
 * @param {Array} debugEntries - Array of debug objects
 * @param {string} debugDir   - Directory for debug files (created if missing)
 * @param {string} symbol     - Trading pair, e.g. "BTCUSDT"
 * @param {string} timestamp  - ISO timestamp string (safe for filenames)
 */
export function logDebugCandles(debugEntries, debugDir, symbol, timestamp) {
    if (!debugEntries || debugEntries.length === 0) return;
    try {
        if (!fs.existsSync(debugDir)) {
            fs.mkdirSync(debugDir, { recursive: true });
        }
        const safeTs = timestamp.replace(/[:.]/g, '-');
        const filePath = path.join(debugDir, `${symbol}_debug_${safeTs}.ndjson`);
        const ndjson = debugEntries.map(e => JSON.stringify(e)).join('\n');
        fs.writeFileSync(filePath, ndjson);
        console.log(`[backtestLogger] Debug candles → ${filePath} (${debugEntries.length} entries)`);
    } catch (error) {
        console.error('[backtestLogger] Erro ao salvar debug candles:', error.message);
    }
}
