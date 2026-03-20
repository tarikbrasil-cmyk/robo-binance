import { 
    classifyRegimeV5, 
    detectCandlePattern, 
    isMarketConditionAllowed,
    detectMarketStructure
} from './regime_engine.js';

const tradeHistory = {}; // { SYMBOL: [timestamp1, timestamp2, ...] }

/**
 * REGIME ADAPTIVE V5 STRATEGY
 * 1. TRENDING: Pullback near EMA 50
 * 2. SIDEWAYS: Mean Reversion BB + RSI
 * 3. VOLATILE: No Trades
 */
export function evaluateRegimeAdaptiveV5(candles, indicators, index, config, symbol) {
    const idx = index;
    const candle = candles[idx];
    const prevCandle = index > 0 ? candles[idx - 1] : null;
    const indicator = indicators[idx];
    const prevIndicator = index > 0 ? indicators[idx - 1] : null;

    if (!indicator || !prevIndicator || !prevCandle) return null;

    // 1. REGIME DETECTION
    const regime = classifyRegimeV5(indicator);
    if (idx % 500 === 0) console.log(`[Regime V5] Index: ${idx} | Regime: ${regime} | ADX: ${indicator.adx?.toFixed(1)} | ATR Ratio: ${(indicator.atr / indicator.atrSma50)?.toFixed(2)}`);
    
    if (regime === 'VOLATILE') return null; // NO TRADES in volatile

    // 2. ANTI-OVERTRADING FILTERS
    const nowTs = candle.ts;
    if (!tradeHistory[symbol]) tradeHistory[symbol] = [];
    
    // Filter history last 24h
    tradeHistory[symbol] = tradeHistory[symbol].filter(ts => nowTs - ts < 24 * 60 * 60 * 1000);
    
    // Max 3 trades per day
    if (tradeHistory[symbol].length >= 3) return null;
    
    // Cooldown: 4 Hours
    const lastTradeTs = tradeHistory[symbol][tradeHistory[symbol].length - 1] || 0;
    if (nowTs - lastTradeTs < 4 * 60 * 60 * 1000) return null;

    // 3. INDICATORS
    const { 
        emaFast, // 20
        emaSlow, // 50
        emaHTF,  // 200 (or 1000 if simulated)
        adx, 
        rsi, 
        atr, 
        bb 
    } = indicator;

    if (!emaSlow || !adx || !rsi || !atr || !bb) return null;

    // 4. ENTRY LOGIC
    
    // --- TREND MODE ---
    if (regime === 'TRENDING') {
        const isTrendUp = emaFast > emaSlow && candle.close > emaHTF;
        const isTrendDown = emaFast < emaSlow && candle.close < emaHTF;

        // BUY (Trend Up)
        if (isTrendUp) {
            // Pullback near EMA 50 (max 1.5 ATR away)
            const nearEMA50 = Math.abs(candle.close - emaSlow) < atr * 1.5;
            const rsiOk = rsi >= 40 && rsi <= 55; // Pullback area
            const confirmation = candle.close > candle.open && candle.close > prevCandle.high;
            
            if (nearEMA50 && rsiOk && confirmation) {
                recordTradeV5(symbol, nowTs);
                return buildSignalV5(symbol, 'BUY', candle.close, atr, config);
            }
        }

        // SELL (Trend Down)
        if (isTrendDown) {
            // Pullback near EMA 50
            const nearEMA50 = Math.abs(candle.close - emaSlow) < atr * 1.5;
            const rsiOk = rsi >= 45 && rsi <= 60; // Pullback area
            const confirmation = candle.close < candle.open && candle.close < prevCandle.low;
            
            if (nearEMA50 && rsiOk && confirmation) {
                recordTradeV5(symbol, nowTs);
                return buildSignalV5(symbol, 'SELL', candle.close, atr, config);
            }
        }
    }

    // --- SIDEWAYS MODE ---
    if (regime === 'SIDEWAYS') {
        const isBullishReversal = candle.close > candle.open && candle.close > prevCandle.high;
        const isBearishReversal = candle.close < candle.open && candle.close < prevCandle.low;

        // BUY (Mean Reversion)
        if (rsi < 30 && prevCandle.low <= bb.lower && isBullishReversal) {
            recordTradeV5(symbol, nowTs);
            return buildSignalV5(symbol, 'BUY', candle.close, atr, config);
        }

        // SELL (Mean Reversion)
        if (rsi > 70 && prevCandle.high >= bb.upper && isBearishReversal) {
            recordTradeV5(symbol, nowTs);
            return buildSignalV5(symbol, 'SELL', candle.close, atr, config);
        }
    }

    return null;
}

function recordTradeV5(symbol, ts) {
    if (!tradeHistory[symbol]) tradeHistory[symbol] = [];
    tradeHistory[symbol].push(ts);
}

function buildSignalV5(symbol, signal, price, atr, config) {
    // Risk Management V5
    // SL: 1.5x ATR
    // TP: 2R Minimum
    const slMult = 1.5;
    const tpMult = 3.0; // 2R (1.5 * 2)

    const slDist = atr * slMult;
    const tpDist = atr * tpMult;

    return {
        symbol,
        signal,
        strategy: 'REGIME_ADAPTIVE_V5',
        entryPrice: price, 
        stopLossPrice: signal === 'BUY' ? price - slDist : price + slDist,
        takeProfitPrice: signal === 'BUY' ? price + tpDist : price - tpDist,
        tp1Price: null, // V5 uses BE and Trailing instead of fixed TP1 50%
        ts: Date.now()
    };
}
