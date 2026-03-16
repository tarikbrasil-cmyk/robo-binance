import exchange, { IS_SPOT } from '../services/exchangeClient.js';

export async function fetchRecentKlines(symbol, timeframe = '1m', limit = 200) {
    try {
        const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
        return ohlcv;
    } catch (e) {
        console.error(`[DATA LAYER] Erro ao buscar klines para ${symbol}:`, e.message);
        return [];
    }
}

export async function getFundingRate(symbol) {
    // Funding Rate não existe em Spot
    if (IS_SPOT) return 0;
    
    try {
        const info = await exchange.fetchFundingRate(symbol);
        return info.fundingRate || 0;
    } catch (e) {
        console.warn(`[DATA LAYER] Não foi possível ler Funding Rate para ${symbol}`);
        return 0;
    }
}
