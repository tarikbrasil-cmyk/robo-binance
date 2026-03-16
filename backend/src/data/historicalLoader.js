import fs from 'fs';
import path from 'path';
import axios from 'axios';

/**
 * Carrega candles históricos do Binance ou cache local.
 */
export async function loadHistoricalData(symbol, interval, startTime, endTime) {
    // Garantir que a pasta de dados históricos existe
    const dataDir = path.join(process.cwd(), 'historical_data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

    const filePath = path.join(dataDir, `${symbol}_${interval}.csv`);
    
    // Se existir arquivo local, poderíamos implementar leitura aqui (opcional)
    // Para simplificar a versão pronta, vamos baixar da API
    
    const limit = 1000;
    const candles = [];
    let start = startTime;
    
    console.log(`Baixando dados de ${symbol} em blocos de ${limit} (intervalo: 1m)...`);

    while (start < endTime) {
        const end = Math.min(endTime, start + limit * 60000); // 1000 candles de 1m
        try {
            const resp = await axios.get('https://fapi.binance.com/fapi/v1/klines', {
                params: { 
                    symbol: symbol.toUpperCase(), 
                    interval: '1m', 
                    startTime: start, 
                    endTime: end, 
                    limit 
                }
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
                start = candles[candles.length - 1].ts + 60000;
            } else {
                break;
            }
        } catch (error) {
            console.error('Erro ao baixar candles (1m):', error.message);
            break;
        }
    }
    return candles;
}
