import { 
    detectMarketRegime, 
    detectCandlePattern, 
    isMarketConditionAllowed,
    detectMarketStructure,
    getEmaSlope
} from './regime_engine.js';

const tradeHistory = {}; // { SYMBOL: [timestamp1, timestamp2, ...] }

/**
 * Institutional Alpha V1 Strategy
 * Version 5: Pullback Optimized + Risk Sync
 */
export function evaluateInstitutionalAlpha(candles, indicators, index, config, symbol) {
    const idx = index;
    const candle = candles[idx];
    const prevCandle = index > 0 ? candles[idx - 1] : null;
    const indicator = indicators[idx];
    const prevIndicator = index > 0 ? indicators[idx - 1] : null;

    if (!indicator || !prevIndicator || !prevCandle) return null;

    // 1. PARAMETERS
    const params = config.institutionalAlpha || {
        volumeMultiplier: 1.5,
        atrExpansionMultiplier: 1.1,
        maxTradesPerDay: 8,
        cooldownMinutes: 60
    };

    const maxDayTrades = params.maxTradesPerDay;
    const cooldownMs = params.cooldownMinutes * 60 * 1000;

    // 2. ANTI-OVERTRADING
    const nowTs = candle.ts;
    if (!tradeHistory[symbol]) tradeHistory[symbol] = [];
    tradeHistory[symbol] = tradeHistory[symbol].filter(ts => nowTs - ts < 24 * 60 * 60 * 1000);
    if (tradeHistory[symbol].length >= maxDayTrades) return null;
    const lastTradeTs = tradeHistory[symbol][tradeHistory[symbol].length - 1] || 0;
    if (nowTs - lastTradeTs < cooldownMs) return null;

    // 3. INDICATORS
    const { 
        emaHTF, 
        emaFast, 
        emaSlow,
        emaFastSlope,
        adx,
        rsi,
        volume, 
        volSma, 
        atr, 
        atrSma50
    } = indicator;

    if (!emaHTF || !emaFast || !emaSlow || !volSma || !atrSma50) return null;

    // 4. TREND & MOMENTUM (High Probability)
    const isBullTrend = candle.close > emaHTF && emaFast > emaSlow;
    const isBearTrend = candle.close < emaHTF && emaFast < emaSlow;
    const isTrending = adx > 25;

    // 5. VOLATILITY & VOLUME EXPANSION
    const isVolatilityExpanding = atr > atrSma50 * params.atrExpansionMultiplier;
    const isVolumeExpanding = volume > volSma * params.volumeMultiplier;

    // 6. TRIGGER
    const pattern = detectCandlePattern(candle, prevCandle);
    
    // LONG: Pullback followed by Bullish Signal
    if (isBullTrend && rsi < 65) {
        const touchedEMA = prevCandle.low <= emaFast * 1.001 || prevCandle.low <= emaSlow * 1.001;
        const isReversal = (pattern === 'ENGULFING_BULLISH' || pattern === 'REJECTION_BULLISH' || (candle.close > candle.open && candle.close > prevCandle.high));
        
        if (touchedEMA && isReversal && isVolatilityExpanding && isVolumeExpanding && isTrending) {
            recordTrade(symbol, nowTs);
            return buildInstitutionalSignal(symbol, 'BUY', candle.close, atr, config);
        }
    }

    // SHORT: Pullback followed by Bearish Signal
    if (isBearTrend && rsi > 35) {
        const touchedEMA = prevCandle.high >= emaFast * 0.999 || prevCandle.high >= emaSlow * 0.999;
        const isReversal = (pattern === 'ENGULFING_BEARISH' || pattern === 'REJECTION_BEARISH' || (candle.close < candle.open && candle.close < prevCandle.low));
        
        if (touchedEMA && isReversal && isVolatilityExpanding && isVolumeExpanding && isTrending) {
            recordTrade(symbol, nowTs);
            return buildInstitutionalSignal(symbol, 'SELL', candle.close, atr, config);
        }
    }

    return null;
}

function recordTrade(symbol, ts) {
    if (!tradeHistory[symbol]) tradeHistory[symbol] = [];
    tradeHistory[symbol].push(ts);
}

function buildInstitutionalSignal(symbol, signal, price, atr, config) {
    // Quality trades: 3.0 ATR SL for room to breathe, 2:1 Reward
    const slMult = 3.0; 
    const tp1Mult = 6.0; // 2R
    const tpFinalMult = 9.0; // 3R

    const slDist = atr * slMult;
    const tp1Dist = atr * tp1Mult;
    const tpFinalDist = atr * tpFinalMult;

    return {
        symbol,
        signal,
        strategy: 'INSTITUTIONAL_ALPHA_V1',
        entryPrice: price, 
        stopLossPrice: signal === 'BUY' ? price - slDist : price + slDist,
        takeProfitPrice: signal === 'BUY' ? price + tpFinalDist : price - tpFinalDist,
        tp1Price: signal === 'BUY' ? price + tp1Dist : price - tp1Dist,
        ts: Date.now()
    };
}
