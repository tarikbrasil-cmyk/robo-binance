import { 
    detectMarketRegime, 
    detectCandlePattern, 
    isMarketConditionAllowed,
    detectMarketStructure,
    getEmaSlope
} from './regime_engine.js';

const tradeHistory = {}; // { SYMBOL: [timestamp1, timestamp2, ...] }

export function evaluateStrategyV3(candles, indicators, index, config, symbol) {
    const idx = index;
    const candle = candles[idx];
    const prevCandle = index > 0 ? candles[idx - 1] : null;
    const indicator = indicators[idx];
    const prevIndicator = index > 0 ? indicators[idx - 1] : null;

    if (!indicator || !prevIndicator || !prevCandle) return null;

    // 1. STRICT PARAMETER VALIDATION
    const trendAdx = config.regime?.trendAdxThreshold;
    const minSlope = config.trendStrategy?.minSlope;
    const maxDayTrades = config.general?.maxTradesPerDay;
    const minIntervalHr = config.general?.minEntryIntervalHours;

    if ([trendAdx, minSlope, maxDayTrades, minIntervalHr].some(v => v === undefined)) {
        return null; // Silently fail in prod or throw in debug
    }

    // 2. FREQUENCY CONTROL (Anti-Overtrading)
    const nowTs = candle.ts;
    if (!tradeHistory[symbol]) tradeHistory[symbol] = [];
    
    // Filter history to last 24h
    tradeHistory[symbol] = tradeHistory[symbol].filter(ts => nowTs - ts < 24 * 60 * 60 * 1000);
    
    // Day Limit
    if (tradeHistory[symbol].length >= maxDayTrades) return null;
    
    // Interval Limit
    const lastTradeTs = tradeHistory[symbol][tradeHistory[symbol].length - 1] || 0;
    if (nowTs - lastTradeTs < minIntervalHr * 60 * 60 * 1000) return null;

    // 3. MARKET STRUCTURE & SLOPE (EDGE REAL)
    const structure = detectMarketStructure(candles, index, 20); // HH/HL or LH/LL
    const emaFastSlope = getEmaSlope(indicators, index, 20);

    // 4. GENERAL FILTERS (Regime + Volatility)
    const regime = detectMarketRegime(indicator, config);
    if (regime === 'LOW_VOL' || !isMarketConditionAllowed(indicator, candle, config)) return null;

    // 5. ENTRY LOGIC: TREND Following
    const { emaFast, emaSlow, adx, rsi, atr, vwap } = indicator;
    const pattern = detectCandlePattern(candle, prevCandle);
    const body = Math.abs(candle.close - candle.open);
    
    // Strong Confirmation: Known pattern OR Significant Bullish Body
    const isStrongBull = candle.close > candle.open && body > atr * 0.2;
    const isStrongBear = candle.close < candle.open && body > atr * 0.2;

    const isBull = emaFast > emaSlow && emaFastSlope > minSlope && structure === 'BULLISH_STRUCTURE';
    const isBear = emaFast < emaSlow && emaFastSlope < -minSlope && structure === 'BEARISH_STRUCTURE';

    // LONG
    if (isBull && candle.close > emaSlow) {
        const isPullback = Math.abs(candle.close - emaFast) < atr * 2.5 || Math.abs(candle.close - vwap) < atr * 2.5;
        const isRsiOk = rsi >= 35 && rsi <= 65;
        const isConfirmed = pattern === 'ENGULFING_BULLISH' || pattern === 'REJECTION_BULLISH' || isStrongBull;

        if (isPullback && isRsiOk && isConfirmed && adx > trendAdx) {
            recordTrade(symbol, nowTs);
            return buildSignalV3(symbol, 'BUY', candle.close, atr, config);
        }
    }

    // SHORT
    if (isBear && candle.close < emaSlow) {
        const isPullback = Math.abs(candle.close - emaFast) < atr * 2.5 || Math.abs(candle.close - vwap) < atr * 2.5;
        const isRsiOk = rsi >= 35 && rsi <= 65;
        const isConfirmed = pattern === 'ENGULFING_BEARISH' || pattern === 'REJECTION_BEARISH' || isStrongBear;

        if (isPullback && isRsiOk && isConfirmed && adx > trendAdx) {
            recordTrade(symbol, nowTs);
            return buildSignalV3(symbol, 'SELL', candle.close, atr, config);
        }
    }

    return null;
}

function recordTrade(symbol, ts) {
    tradeHistory[symbol].push(ts);
}

function buildSignalV3(symbol, signal, price, atr, config) {
    const slMult = 4.0;
    const tpMult = 12.0;

    const slDist = atr * slMult;
    const tpDist = atr * tpMult;

    return {
        symbol,
        signal,
        strategy: 'TREND_PRO_V3',
        entryPrice: price, 
        stopLossPrice: signal === 'BUY' ? price - slDist : price + slDist,
        takeProfitPrice: signal === 'BUY' ? price + tpDist : price - tpDist,
        tp1Price: signal === 'BUY' ? price + (slDist * 2) : price - (slDist * 2), // 50% at 2R
        ts: Date.now()
    };
}
