/**
 * periodSelector.js
 *
 * Auto-detects sub-windows dominated by a specific market regime (TRENDING, SIDEWAYS,
 * VOLATILE, NEUTRAL) within a larger historical date range.
 *
 * Usage:
 *   import { selectRegimePeriods } from './periodSelector.js';
 *
 *   // Find all 14-day windows where TRENDING regime dominates ≥ 60 % of candles
 *   const periods = await selectRegimePeriods('BTCUSDT', startMs, endMs, 'TRENDING');
 *
 *   // Return value: Array<{ start: number, end: number, regime: string, dominance: number }>
 */

import { loadHistoricalData } from './historicalLoader.js';
import { calculateIndicators, classifyRegimeV5 } from '../strategy/regime_engine.js';

// Default sliding window — 14 days in ms
const DEFAULT_WINDOW_DAYS = 14;
const DEFAULT_STEP_DAYS   = 7;
const DEFAULT_DOMINANCE   = 0.60; // 60 % of candles must match the target regime

/**
 * Select time windows where the target regime dominates.
 *
 * @param {string}  symbol            e.g. 'BTCUSDT'
 * @param {number}  startMs           Range start (Unix ms)
 * @param {number}  endMs             Range end   (Unix ms)
 * @param {string}  targetRegime      'TRENDING' | 'SIDEWAYS' | 'VOLATILE' | 'NEUTRAL'
 * @param {object}  [opts]
 * @param {string}  [opts.timeframe]  e.g. '5m', '15m', '1h'  (default '1h')
 * @param {string}  [opts.mode]       'FUTURES' | 'SPOT'       (default 'FUTURES')
 * @param {number}  [opts.windowDays] Sliding window size in days (default 14)
 * @param {number}  [opts.stepDays]   Step size in days         (default 7)
 * @param {number}  [opts.minDominance] Min fraction of candles matching regime (default 0.60)
 * @returns {Promise<Array<{start:number, end:number, regime:string, dominance:number}>>}
 */
export async function selectRegimePeriods(symbol, startMs, endMs, targetRegime, opts = {}) {
    const {
        timeframe    = '1h',
        mode         = 'FUTURES',
        windowDays   = DEFAULT_WINDOW_DAYS,
        stepDays     = DEFAULT_STEP_DAYS,
        minDominance = DEFAULT_DOMINANCE,
    } = opts;

    const regime = targetRegime.toUpperCase();
    const validRegimes = new Set(['TRENDING', 'SIDEWAYS', 'VOLATILE', 'NEUTRAL']);
    if (!validRegimes.has(regime)) throw new Error(`Regime inválido: "${targetRegime}". Use: TRENDING | SIDEWAYS | VOLATILE | NEUTRAL`);

    const TF_MS = {
        '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
        '30m': 1_800_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000,
    };
    const candleMs  = TF_MS[timeframe] || 3_600_000;
    const windowMs  = windowDays * 86_400_000;
    const stepMs    = stepDays   * 86_400_000;

    console.log(`[PeriodSelector] Carregando ${symbol} ${timeframe} ${mode} para período ${new Date(startMs).toISOString().slice(0,10)} → ${new Date(endMs).toISOString().slice(0,10)}`);

    const candles = await loadHistoricalData(symbol, timeframe, startMs, endMs, mode);
    if (!candles || candles.length < 100) {
        console.warn('[PeriodSelector] Dados insuficientes.');
        return [];
    }

    console.log(`[PeriodSelector] Calculando indicadores para ${candles.length} candles...`);
    const indicators = calculateIndicators(candles, null);

    const results = [];
    let wStart = startMs;

    while (wStart + windowMs <= endMs) {
        const wEnd = wStart + windowMs;

        // Find candle indices for this window
        let iStart = candles.findIndex(c => c.ts >= wStart);
        let iEnd   = candles.findIndex(c => c.ts >= wEnd);
        if (iStart < 0) { wStart += stepMs; continue; }
        if (iEnd < 0) iEnd = candles.length;

        const slice = indicators.slice(iStart, iEnd).filter(Boolean);
        if (slice.length < 10) { wStart += stepMs; continue; }

        const regimeCounts = { TRENDING: 0, SIDEWAYS: 0, VOLATILE: 0, NEUTRAL: 0 };
        for (const ind of slice) {
            const r = classifyRegimeV5(ind);
            regimeCounts[r] = (regimeCounts[r] || 0) + 1;
        }

        const dominance = regimeCounts[regime] / slice.length;
        if (dominance >= minDominance) {
            results.push({
                start:    wStart,
                end:      wEnd,
                regime,
                dominance: parseFloat(dominance.toFixed(3)),
                startISO: new Date(wStart).toISOString().slice(0, 10),
                endISO:   new Date(wEnd).toISOString().slice(0, 10),
                candles:  slice.length,
                regimeCounts,
            });
        }

        wStart += stepMs;
    }

    console.log(`[PeriodSelector] ${results.length} janela(s) ${regime} encontradas com dominância ≥ ${(minDominance*100).toFixed(0)}%`);
    return results;
}

/**
 * Convenience: return the best (most dominant) single period for each regime type.
 *
 * @returns {Promise<Record<string, object|null>>}
 */
export async function getBestPeriodsByRegime(symbol, startMs, endMs, opts = {}) {
    const regimes = ['TRENDING', 'SIDEWAYS', 'VOLATILE'];
    const result  = {};

    for (const regime of regimes) {
        const periods = await selectRegimePeriods(symbol, startMs, endMs, regime, opts);
        result[regime] = periods.sort((a, b) => b.dominance - a.dominance)[0] || null;
    }

    return result;
}
