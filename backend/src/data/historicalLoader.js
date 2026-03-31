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
export async function loadHistoricalData(symbol, interval, startTime, endTime, mode = 'FUTURES') {
    const isSpot = mode.toUpperCase() === 'SPOT';
    const klinesUrl = isSpot
        ? 'https://api.binance.com/api/v3/klines'
        : 'https://fapi.binance.com/fapi/v1/klines';

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
            const resp = await axios.get(klinesUrl, {
                params: { 
                    symbol: symbol.toUpperCase(), 
                    interval: interval, 
                    startTime: start, 
                    endTime: end, 
                    limit 
                },
                timeout: 10000 // 10s timeout
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
