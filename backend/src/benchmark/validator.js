/**
 * Validator — Data integrity checks for columnar datasets.
 *
 * Checks: timestamp gaps, duplicates, sequencing, OHLCV sanity.
 * Returns structured report per dataset.
 */
import { getData } from './columnStore.js';

const TF_MS = {
    '1m':  60_000,
    '3m':  180_000,
    '5m':  300_000,
    '15m': 900_000,
    '30m': 1_800_000,
    '1h':  3_600_000,
    '4h':  14_400_000,
};

/**
 * Validate a single dataset.
 * @returns {{ ok, candles, gaps, duplicates, badOHLCV, outOfOrder, details }}
 */
export function validateDataset(symbol, timeframe) {
    const ds = getData(symbol, timeframe);
    if (!ds || ds.length === 0) {
        return { ok: false, candles: 0, error: 'Dataset not loaded' };
    }

    const expectedInterval = TF_MS[timeframe] || 60_000;
    const gaps       = [];
    const duplicates = [];
    const outOfOrder = [];
    const badOHLCV   = [];

    for (let i = 0; i < ds.length; i++) {
        // OHLCV sanity
        const o = ds.open[i], h = ds.high[i], l = ds.low[i], c = ds.close[i], v = ds.volume[i];
        if (h < l || h < o || h < c || l > o || l > c || v < 0 || isNaN(o) || isNaN(h) || isNaN(l) || isNaN(c)) {
            badOHLCV.push(i);
        }

        if (i === 0) continue;

        const prevTs = ds.timestamps[i - 1];
        const curTs  = ds.timestamps[i];

        // Duplicate
        if (curTs === prevTs) {
            duplicates.push(i);
            continue;
        }

        // Out of order
        if (curTs < prevTs) {
            outOfOrder.push(i);
            continue;
        }

        // Gap detection
        const delta = curTs - prevTs;
        if (delta > expectedInterval * 1.5) {
            gaps.push({
                index: i,
                from: new Date(prevTs).toISOString(),
                to:   new Date(curTs).toISOString(),
                missingCandles: Math.round(delta / expectedInterval) - 1,
            });
        }
    }

    const ok = gaps.length === 0 && duplicates.length === 0 && outOfOrder.length === 0 && badOHLCV.length === 0;

    return {
        ok,
        candles: ds.length,
        gaps: gaps.length,
        duplicates: duplicates.length,
        outOfOrder: outOfOrder.length,
        badOHLCV: badOHLCV.length,
        details: ok ? null : { gaps: gaps.slice(0, 5), duplicates: duplicates.slice(0, 5), outOfOrder: outOfOrder.slice(0, 5), badOHLCV: badOHLCV.slice(0, 5) },
    };
}

/**
 * Validate all loaded datasets for given symbols × timeframes.
 */
export function validateAll(symbols, timeframes) {
    const results = [];
    for (const symbol of symbols) {
        for (const tf of timeframes) {
            results.push({ symbol, timeframe: tf, ...validateDataset(symbol, tf) });
        }
    }
    return results;
}
