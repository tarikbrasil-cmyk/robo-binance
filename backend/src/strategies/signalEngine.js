import { EMA, RSI, ATR } from 'technicalindicators';
import { IS_SPOT } from '../services/exchangeClient.js';

/**
 * Signal Engine - Analisa dados de mercado e fornece score de direção (LONG/SHORT/NEUTRAL)
 */

export function analyzeTrendAndMomentum(klines) {
    if (!klines || klines.length < 200) {
        return { signal: 'NEUTRAL', reason: 'Not enough data' };
    }

    // Extrai preços de fechamento, máximas e mínimas do array de klines
    // Formato Binance kline: [tempo, open, high, low, close, volume, ...]
    const closes = klines.map(k => parseFloat(k[4]));
    const highs = klines.map(k => parseFloat(k[2]));
    const lows = klines.map(k => parseFloat(k[3]));

    // Calcula EMAs
    const ema20 = EMA.calculate({ period: 20, values: closes });
    const ema50 = EMA.calculate({ period: 50, values: closes });
    const ema200 = EMA.calculate({ period: 200, values: closes });

    // Calcula RSI
    const rsi14 = RSI.calculate({ period: 14, values: closes });

    // Calcula ATR
    const inputATR = { high: highs, low: lows, close: closes, period: 14 };
    const atr14 = ATR.calculate(inputATR);

    // Valores mais recentes
    const currentEma20 = ema20[ema20.length - 1];
    const currentEma50 = ema50[ema50.length - 1];
    const currentEma200 = ema200[ema200.length - 1];
    const currentRsi = rsi14[rsi14.length - 1];
    
    // ATR Threshold (Filtro de volatilidade simples)
    // Opcional: calcular média dos últimos X ATRs
    const currentAtr = atr14[atr14.length - 1];
    const avgAtr24h = atr14.slice(-24).reduce((a, b) => a + b, 0) / 24; // Aproximação (depende do timeframe)

    let isVolatile = currentAtr > (avgAtr24h * 0.9); // Leve margem

    // Regras de LONG
    // EMA20 > EMA50 > EMA200 (Tendência Alta)
    // RSI < 35 (Pullback/Sobrevenda local em Trend)
    const isUptrend = currentEma20 > currentEma50 && currentEma50 > currentEma200;
    if (isUptrend && currentRsi < 35 && isVolatile) {
        return { 
            signal: 'BUY', 
            confidence: 0.8, // Usado futuramente pro Compounding Base
            indicators: { ema20: currentEma20, ema50: currentEma50, rsi: currentRsi, atr: currentAtr }
        };
    }

    // Regras de SHORT (só válido em FUTURES — em SPOT, short não existe)
    // EMA20 < EMA50 < EMA200 (Tendência Baixa)
    // RSI > 65 (Respiro/Sobrecompra local em Trend Baixa)
    const isDowntrend = currentEma20 < currentEma50 && currentEma50 < currentEma200;
    if (isDowntrend && currentRsi > 65 && isVolatile) {
        // Em modo SPOT, ignorar SHORT completamente
        if (IS_SPOT) {
            return { signal: 'NEUTRAL', reason: 'SPOT mode: SELL/short signal suppressed' };
        }
        return { 
            signal: 'SELL', 
            confidence: 0.8,
            indicators: { ema20: currentEma20, ema50: currentEma50, rsi: currentRsi, atr: currentAtr } 
        };
    }

    return { 
        signal: 'NEUTRAL', 
        reason: 'Market condition not met',
        indicators: { ema20: currentEma20, rsi: currentRsi }
    };
}
