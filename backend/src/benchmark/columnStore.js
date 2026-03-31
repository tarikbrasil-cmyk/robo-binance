/**
 * ColumnStore — High-performance columnar in-memory data store.
 *
 * Layout per dataset: 6 parallel Float64Arrays (ts, O, H, L, C, V).
 * Binary disk cache: header (8 bytes) + raw Float64 data.
 * O(1) candle access, zero-copy getData(), SIMD-friendly sequential iteration.
 */
import fs from 'fs';
import path from 'path';

const FIELDS     = 6; // ts, open, high, low, close, volume
const F64_BYTES  = 8;
const HEADER_LEN = 8; // uint32 count + uint32 reserved

// ── In-memory store ──────────────────────────────────────────────────────────
// store[symbol][timeframe] = { length, timestamps, open, high, low, close, volume }
const store = {};

const CACHE_DIR = path.join(process.cwd(), 'benchmark_cache');

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * getData(symbol, timeframe) → direct reference to typed arrays (NOT copies).
 * Returns null if dataset not loaded.
 */
export function getData(symbol, timeframe) {
    return store[symbol]?.[timeframe] ?? null;
}

/**
 * Slice by ms epoch range. Returns { startIdx, endIdx } for zero-copy iteration.
 * Uses binary search for O(log n).
 */
export function sliceByRange(symbol, timeframe, fromMs, toMs) {
    const ds = getData(symbol, timeframe);
    if (!ds) return null;
    const startIdx = lowerBound(ds.timestamps, fromMs);
    const endIdx   = upperBound(ds.timestamps, toMs);
    return { startIdx, endIdx, dataset: ds };
}

/**
 * Store a dataset from raw candle array [{ts, open, high, low, close, volume}].
 * Overwrites any existing data for the same symbol+timeframe combo within the range.
 * Merges with existing data if present.
 */
export function ingest(symbol, timeframe, candles) {
    if (!candles || candles.length === 0) return;

    if (!store[symbol]) store[symbol] = {};

    const existing = store[symbol][timeframe];
    let merged = candles;

    if (existing) {
        // Merge: convert existing typed arrays back, combine, dedupe, sort
        const old = [];
        for (let i = 0; i < existing.length; i++) {
            old.push({
                ts:     existing.timestamps[i],
                open:   existing.open[i],
                high:   existing.high[i],
                low:    existing.low[i],
                close:  existing.close[i],
                volume: existing.volume[i],
            });
        }
        const map = new Map();
        for (const c of old)    map.set(c.ts, c);
        for (const c of candles) map.set(c.ts, c);
        merged = Array.from(map.values()).sort((a, b) => a.ts - b.ts);
    }

    const n  = merged.length;
    const ts = new Float64Array(n);
    const op = new Float64Array(n);
    const hi = new Float64Array(n);
    const lo = new Float64Array(n);
    const cl = new Float64Array(n);
    const vo = new Float64Array(n);

    for (let i = 0; i < n; i++) {
        ts[i] = merged[i].ts;
        op[i] = merged[i].open;
        hi[i] = merged[i].high;
        lo[i] = merged[i].low;
        cl[i] = merged[i].close;
        vo[i] = merged[i].volume;
    }

    store[symbol][timeframe] = {
        length:     n,
        timestamps: ts,
        open:       op,
        high:       hi,
        low:        lo,
        close:      cl,
        volume:     vo,
    };
}

/**
 * Convert columnar dataset to object-array (for indicator calculation compatibility).
 * Optionally slice by index range [from, to).
 */
export function toObjectArray(symbol, timeframe, from = 0, to = -1) {
    const ds = getData(symbol, timeframe);
    if (!ds) return [];
    const end = to < 0 ? ds.length : Math.min(to, ds.length);
    const result = new Array(end - from);
    for (let i = from; i < end; i++) {
        result[i - from] = {
            ts:     ds.timestamps[i],
            open:   ds.open[i],
            high:   ds.high[i],
            low:    ds.low[i],
            close:  ds.close[i],
            volume: ds.volume[i],
        };
    }
    return result;
}

// ── Binary cache ─────────────────────────────────────────────────────────────

function cacheKey(symbol, tf, regimeTag) {
    return `${symbol}_${tf}${regimeTag ? '_' + regimeTag : ''}`;
}

export function saveToDisk(symbol, timeframe, regimeTag = '') {
    const ds = getData(symbol, timeframe);
    if (!ds) return;
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

    const n   = ds.length;
    const buf = Buffer.alloc(HEADER_LEN + n * FIELDS * F64_BYTES);
    buf.writeUInt32LE(n, 0);
    buf.writeUInt32LE(0, 4); // reserved

    let offset = HEADER_LEN;
    const arrays = [ds.timestamps, ds.open, ds.high, ds.low, ds.close, ds.volume];
    for (const arr of arrays) {
        Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).copy(buf, offset);
        offset += arr.byteLength;
    }

    const filePath = path.join(CACHE_DIR, `${cacheKey(symbol, timeframe, regimeTag)}.bin`);
    fs.writeFileSync(filePath, buf);
}

export function loadFromDisk(symbol, timeframe, regimeTag = '') {
    const filePath = path.join(CACHE_DIR, `${cacheKey(symbol, timeframe, regimeTag)}.bin`);
    if (!fs.existsSync(filePath)) return false;

    const buf = fs.readFileSync(filePath);
    const n   = buf.readUInt32LE(0);
    if (n === 0) return false;

    const ts = new Float64Array(n);
    const op = new Float64Array(n);
    const hi = new Float64Array(n);
    const lo = new Float64Array(n);
    const cl = new Float64Array(n);
    const vo = new Float64Array(n);

    let offset = HEADER_LEN;
    const arrays = [ts, op, hi, lo, cl, vo];
    for (const arr of arrays) {
        const bytes = n * F64_BYTES;
        const src   = buf.subarray(offset, offset + bytes);
        new Uint8Array(arr.buffer).set(src);
        offset += bytes;
    }

    if (!store[symbol]) store[symbol] = {};
    store[symbol][timeframe] = { length: n, timestamps: ts, open: op, high: hi, low: lo, close: cl, volume: vo };
    return true;
}

/**
 * Check if binary cache exists for a given key.
 */
export function hasDiskCache(symbol, timeframe, regimeTag = '') {
    const filePath = path.join(CACHE_DIR, `${cacheKey(symbol, timeframe, regimeTag)}.bin`);
    return fs.existsSync(filePath);
}

/**
 * Get memory usage summary.
 */
export function getMemoryStats() {
    let totalCandles = 0;
    let totalBytes   = 0;
    const details    = [];
    for (const sym of Object.keys(store)) {
        for (const tf of Object.keys(store[sym])) {
            const ds = store[sym][tf];
            totalCandles += ds.length;
            const bytes = ds.length * FIELDS * F64_BYTES;
            totalBytes += bytes;
            details.push({ symbol: sym, timeframe: tf, candles: ds.length, bytes });
        }
    }
    return { totalCandles, totalBytes, totalMB: (totalBytes / 1048576).toFixed(2), details };
}

// ── Utilities ────────────────────────────────────────────────────────────────

function lowerBound(arr, target) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid] < target) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function upperBound(arr, target) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid] <= target) lo = mid + 1;
        else hi = mid;
    }
    return lo - 1;
}
