/**
 * Downloader — Paginated Binance Futures klines fetcher.
 *
 * Handles API rate limits (1200 req/min), pagination (1000 candles/page),
 * progress reporting, and feeds directly into the ColumnStore.
 */
import axios from 'axios';
import { ingest, hasDiskCache, loadFromDisk, saveToDisk } from './columnStore.js';

const KLINES_URL = 'https://fapi.binance.com/fapi/v1/klines';
const PAGE_LIMIT = 1500;  // Binance max
const DELAY_MS   = 80;    // ~12 req/s → well within 1200/min

// Timeframe → milliseconds per candle
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
 * Download klines for a single (symbol, timeframe, startMs, endMs).
 * Loads from binary cache if available; otherwise downloads and caches.
 *
 * @param {string} symbol
 * @param {string} timeframe
 * @param {number} startMs   - inclusive
 * @param {number} endMs     - inclusive
 * @param {string} regimeTag - cache key suffix (e.g. "BULL")
 * @param {Function} [onProgress] - (downloaded, estimated) callback
 * @returns {number} candle count loaded
 */
export async function downloadDataset(symbol, timeframe, startMs, endMs, regimeTag = '', onProgress = null) {
    // 1. Try binary disk cache first
    if (hasDiskCache(symbol, timeframe, regimeTag)) {
        const ok = loadFromDisk(symbol, timeframe, regimeTag);
        if (ok) {
            console.log(`[CACHE HIT] ${symbol} ${timeframe} ${regimeTag}`);
            return true;
        }
    }

    // 2. Download from Binance
    const candleMs   = TF_MS[timeframe] || 60_000;
    const estimated  = Math.ceil((endMs - startMs) / candleMs);
    const allCandles = [];
    let cursor       = startMs;
    let retries      = 0;

    console.log(`[DOWNLOAD] ${symbol} ${timeframe} ${regimeTag} | ~${estimated} candles expected`);

    while (cursor <= endMs) {
        try {
            const resp = await axios.get(KLINES_URL, {
                params: {
                    symbol,
                    interval: timeframe,
                    startTime: cursor,
                    endTime: endMs,
                    limit: PAGE_LIMIT,
                },
                timeout: 15_000,
            });

            if (!resp.data || resp.data.length === 0) break;

            for (const k of resp.data) {
                allCandles.push({
                    ts:     k[0],
                    open:   parseFloat(k[1]),
                    high:   parseFloat(k[2]),
                    low:    parseFloat(k[3]),
                    close:  parseFloat(k[4]),
                    volume: parseFloat(k[5]),
                });
            }

            cursor  = resp.data[resp.data.length - 1][0] + candleMs;
            retries = 0;

            if (onProgress) onProgress(allCandles.length, estimated);

            await sleep(DELAY_MS);
        } catch (err) {
            retries++;
            if (retries > 5) {
                console.error(`[DOWNLOAD FAILED] ${symbol} ${timeframe} after 5 retries: ${err.message}`);
                break;
            }
            console.warn(`[DOWNLOAD RETRY ${retries}] ${symbol} ${timeframe}: ${err.message}`);
            await sleep(1000 * retries);
        }
    }

    if (allCandles.length === 0) return 0;

    // 3. Ingest into ColumnStore and save binary cache
    ingest(symbol, timeframe, allCandles);
    saveToDisk(symbol, timeframe, regimeTag);

    console.log(`[DOWNLOAD OK] ${symbol} ${timeframe} ${regimeTag} → ${allCandles.length} candles`);
    return allCandles.length;
}

/**
 * Download ALL datasets for a regime definition.
 * @param {Object} regime  - { tag, startMs, endMs }
 * @param {string[]} symbols
 * @param {string[]} timeframes
 * @param {Function} [onProgress] - (phase, detail) callback
 */
export async function downloadRegime(regime, symbols, timeframes, onProgress = null) {
    const results = [];
    for (const symbol of symbols) {
        for (const tf of timeframes) {
            if (onProgress) onProgress('downloading', { symbol, timeframe: tf, regime: regime.tag });
            const count = await downloadDataset(symbol, tf, regime.startMs, regime.endMs, regime.tag, null);
            results.push({ symbol, timeframe: tf, regime: regime.tag, candles: count });
        }
    }
    return results;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
