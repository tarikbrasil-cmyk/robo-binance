/**
 * TREND FOLLOWING PRO V2
 * 
 * Multi-Regime Strategy (TREND / RANGE)
 * Specialized entry/exit criteria for each market state.
 */

import { detectCandlePattern } from './regime_engine.js';

const cooldowns = {}; // symbol -> lastTradeTs

export function evaluateTrendStrategyProV2(candle, prevCandle, indicator, prevIndicator, config, regime, symbol) {
    if (!indicator || !prevIndicator || !prevCandle) return null;

    // ── 0. COOLDOWN CHECK ───────────────────────────────────────────────────
    const lastTradeTs = cooldowns[symbol] || 0;
    const cooldownMs = (config.general?.cooldownMinutes || 30) * 60 * 1000;
    if (candle.ts - lastTradeTs < cooldownMs) return null;

    // ── 1. REGIME DISPATCH ──────────────────────────────────────────────────
    if (regime === 'TREND') {
        return evaluateTrendSubStrategy(candle, prevCandle, indicator, prevIndicator, config, symbol);
    } else if (regime === 'RANGE') {
        return evaluateRangeSubStrategy(candle, prevCandle, indicator, prevIndicator, config, symbol);
    }

    return null;
}

/**
 * [1] TREND SUB-STRATEGY
 */
function evaluateTrendSubStrategy(candle, prevCandle, indicator, prevIndicator, config, symbol) {
    const { emaFast: ema50, emaSlow: ema200, vwap, adx, rsi, volume, volSma, atr, atrPercent } = indicator;
    const pattern = detectCandlePattern(candle, prevCandle);

    const isBullTrend = ema50 > ema200;
    const isBearTrend = ema50 < ema200;

    // Filter: ADX > 25, Volatility > 0.1%
    if (adx <= 30 || volume <= volSma || atrPercent < 0.001) return null;

    // Entry LONG
    if (isBullTrend && candle.close > ema200) {
        const dist50 = Math.abs(candle.close - ema50);
        const distVwap = Math.abs(candle.close - vwap);
        const isPullback = dist50 <= atr * 2.0 || distVwap <= atr * 2.0;
        
        const isRsiOk = rsi >= 40 && rsi <= 60; 
        const isConfirmed = pattern === 'ENGULFING_BULLISH' || pattern === 'REJECTION_BULLISH';

        if (isPullback && isRsiOk && isConfirmed) {
            return buildSignal(symbol, 'BUY', 'TREND_V2', candle.close, atr, 2.0, 6.0, indicator);
        }
    }

    // Entry SHORT
    if (isBearTrend && candle.close < ema200) {
        const dist50 = Math.abs(candle.close - ema50);
        const distVwap = Math.abs(candle.close - vwap);
        const isPullback = dist50 <= atr * 2.0 || distVwap <= atr * 2.0;
        
        const isRsiOk = rsi >= 40 && rsi <= 60;
        const isConfirmed = pattern === 'ENGULFING_BEARISH' || pattern === 'REJECTION_BEARISH';

        if (isPullback && isRsiOk && isConfirmed) {
            return buildSignal(symbol, 'SELL', 'TREND_V2', candle.close, atr, 2.0, 6.0, indicator);
        }
    }

    return null;
}

/**
 * [2] RANGE SUB-STRATEGY
 */
function evaluateRangeSubStrategy(candle, prevCandle, indicator, prevIndicator, config, symbol) {
    const { rsi, atr } = indicator;
    const pattern = detectCandlePattern(candle, prevCandle);

    // Entry LONG: RSI < 30 + Rejection Bullish
    if (rsi < 30 && pattern === 'REJECTION_BULLISH') {
        return buildSignal(symbol, 'BUY', 'RANGE_V2', candle.close, atr, 1.5, 3.0, indicator);
    }

    // Entry SHORT: RSI > 70 + Rejection Bearish
    if (rsi > 70 && pattern === 'REJECTION_BEARISH') {
        return buildSignal(symbol, 'SELL', 'RANGE_V2', candle.close, atr, 1.5, 3.0, indicator);
    }

    return null;
}

function buildSignal(symbol, signal, strategy, price, atr, slMult, tpMult, indicator) {
    const slDistance = atr * slMult;
    const tpDistance = atr * tpMult;

    const stopLossPrice = signal === 'BUY' ? price - slDistance : price + slDistance;
    const takeProfitPrice = signal === 'BUY' ? price + tpDistance : price - tpDistance;

    // TP1 is at 1.5x risk for Trend
    const tp1Distance = strategy === 'TREND_V2' ? atr * slMult * 1.5 : 0;
    const tp1Price = tp1Distance > 0 ? (signal === 'BUY' ? price + tp1Distance : price - tp1Distance) : null;

    cooldowns[symbol] = indicator.ts || Date.now(); 

    return {
        symbol,
        signal,
        strategy,
        entryPrice: price,
        stopLossPrice,
        takeProfitPrice,
        tp1Price,
        indicator,
        atr
    };
}
