import fs from 'fs';
import path from 'path';
import axios from 'axios';

/**
 * Carrega candles históricos do Binance ou cache local.
 * @param {string} symbol   - Ex: "BTCUSDT"
 * @param {string} interval - Ex: "1m", "5m", "15m"
 * @param {number} startTime - ms epoch
 * @param {number} endTime   - ms epoch
 * @param {string} [mode]    - "FUTURES" (default) ou "SPOT"
 */
// Fallback URLs for geo-restricted regions (Render US servers)
// Order: main futures → futures mirrors → Binance.US spot → Bybit futures
const FUTURES_URLS = [
    'https://fapi.binance.com/fapi/v1/klines',
    'https://fapi1.binance.com/fapi/v1/klines',
    'https://fapi2.binance.com/fapi/v1/klines',
    'https://fapi3.binance.com/fapi/v1/klines',
    'https://fapi4.binance.com/fapi/v1/klines',
    'https://api.binance.us/api/v3/klines',
];
const SPOT_URLS = [
    'https://api.binance.com/api/v3/klines',
    'https://api1.binance.com/api/v3/klines',
    'https://api2.binance.com/api/v3/klines',
    'https://api3.binance.com/api/v3/klines',
    'https://api4.binance.com/api/v3/klines',
    'https://api.binance.us/api/v3/klines',
];

// Bybit interval mapping (Binance '5m' → Bybit '5')
const BYBIT_INTERVAL_MAP = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '1d': 'D', '1w': 'W' };

async function fetchFromBybit(params) {
    const bybitInterval = BYBIT_INTERVAL_MAP[params.interval] || params.interval.replace('m', '');
    const resp = await axios.get('https://api.bybit.com/v5/market/kline', {
        params: {
            category: 'linear',
            symbol: params.symbol,
            interval: bybitInterval,
            start: params.startTime,
            end: params.endTime,
            limit: params.limit || 1000,
        },
        timeout: 10000,
    });
    if (!resp.data?.result?.list?.length) throw new Error('Bybit returned no data');
    // Convert Bybit format → Binance format. Bybit returns newest-first, so reverse.
    const binanceFormat = resp.data.result.list.reverse().map(c => [
        parseInt(c[0]), c[1], c[2], c[3], c[4], c[5],
    ]);
    console.log(`[Fallback] ✅ Bybit returned ${binanceFormat.length} candles (converted to Binance format)`);
    return { data: binanceFormat, status: 200 };
}

async function fetchKlinesWithFallback(urls, params) {
    let lastError = null;
    for (const url of urls) {
        try {
            const resp = await axios.get(url, { params, timeout: 10000 });
            // Some mirrors return 200/202 with empty or HTML body — treat as failure
            if (!resp.data || !Array.isArray(resp.data) || resp.data.length === 0) {
                console.warn(`[Fallback] ${url} returned empty/invalid data (status ${resp.status}), trying next...`);
                continue;
            }
            console.log(`[Fallback] ✅ ${url} returned ${resp.data.length} candles`);
            return resp;
        } catch (err) {
            lastError = err;
            const status = err.response?.status || 'network';
            console.warn(`[Fallback] ${url} failed (${status}), trying next...`);
        }
    }
    // Last resort: try Bybit futures API (worldwide access, same BTCUSDT/ETHUSDT prices)
    try {
        console.log('[Fallback] All Binance endpoints failed. Trying Bybit...');
        return await fetchFromBybit(params);
    } catch (bybitErr) {
        console.error('[Fallback] Bybit also failed:', bybitErr.message);
    }
    throw lastError || new Error('All data endpoints failed — server may be in a geo-restricted region');
}

export async function loadHistoricalData(symbol, interval, startTime, endTime, mode = 'FUTURES') {
    const isSpot = mode.toUpperCase() === 'SPOT';
    const fallbackUrls = isSpot ? SPOT_URLS : FUTURES_URLS;

    const dataDir = path.join(process.cwd(), 'historical_data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    // SPOT candles use a separate cache file to avoid mixing data
    const cacheSuffix = isSpot ? '_SPOT_cache.json' : '_cache.json';
    const cacheFile = path.join(dataDir, `${symbol}_${interval}${cacheSuffix}`);
    let cachedData = [];
    if (fs.existsSync(cacheFile)) {
        try {
            cachedData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            // Filter data within requested range
            const filtered = cachedData.filter(c => c.ts >= startTime && c.ts <= endTime);
            
            // Check if we have complete data for the range
            if (filtered.length > 0) {
                const firstTs = filtered[0].ts;
                const lastTs = filtered[filtered.length - 1].ts;
                
                // If the cached range covers the requested range (approx)
                if (firstTs <= startTime && lastTs >= endTime - 60000) {
                    console.log(`[Cache] Usando ${filtered.length} candles cacheados para ${symbol}.`);
                    return filtered;
                }
            }
        } catch (e) {
            console.warn(`[Cache] Erro ao ler cache para ${symbol}, baixando novamente.`);
        }
    }

    const limit = 1000;
    const candles = [];
    let start = startTime;
    const totalExpectedMins = Math.floor((endTime - startTime) / 60000);
    
    console.log(`\n[Download] Iniciando download de ${symbol} (${totalExpectedMins} candles esperados)...`);

    while (start < endTime) {
        const end = Math.min(endTime, start + limit * 60000);
        try {
            const resp = await fetchKlinesWithFallback(fallbackUrls, { 
                    symbol: symbol.toUpperCase(), 
                    interval: interval, 
                    startTime: start, 
                    endTime: end, 
                    limit 
                });

            if (resp.data && resp.data.length > 0) {
                resp.data.forEach(c => {
                    candles.push({ 
                        ts: c[0], 
                        open: parseFloat(c[1]), 
                        high: parseFloat(c[2]), 
                        low: parseFloat(c[3]), 
                        close: parseFloat(c[4]), 
                        volume: parseFloat(c[5]) 
                    });
                });
                
                const progress = (candles.length / totalExpectedMins * 100).toFixed(1);
                process.stdout.write(`\r  > ${symbol}: ${candles.length}/${totalExpectedMins} (${progress}%) `);
                
                start = candles[candles.length - 1].ts + 60000;
                
                // Rate limit protection: 100ms delay between requests
                await new Promise(resolve => setTimeout(resolve, 100));
            } else {
                break;
            }
        } catch (error) {
            console.error(`\n[Download ERROR] ${symbol}:`, error.message);
            break;
        }
    }

    console.log(`\n[Download] Concluído: ${candles.length} candles obtidos para ${symbol}.`);

    // Update Cache
    if (candles.length > 0) {
        const fullData = [...cachedData, ...candles];
        // Remove duplicates and sort
        const uniqueData = Array.from(new Map(fullData.map(c => [c.ts, c])).values())
                                .sort((a, b) => a.ts - b.ts);
        
        fs.writeFileSync(cacheFile, JSON.stringify(uniqueData));
    }

    return candles;
}
