/**
 * Momentum Breakout Strategy (Adaptive V2)
 * 
 * LONG ENTRY:
 * - price > EMA200
 * - EMA50 > EMA200
 * - EMA50 Slope > 0
 * - ADX > 25
 * - Volume > 1.5 * volSma20
 * - Entry: Price > Highest High of last 20 candles
 * 
 * SHORT ENTRY:
 * (Standard momentum breakout is usually long-biased, but here we mirror for futures)
 * - price < EMA200
 * - EMA50 < EMA200
 * - EMA50 Slope < 0
 * - ADX > 25
 * - Volume > 1.5 * volSma20
 * - Entry: Price < Lowest Low of last 20 candles
 * 
 * EXIT:
 * - SL: 1.5 * ATR
 * - TP: 3.0 * ATR
 */
export function evaluateMomentumBreakoutStrategy(candle, indicator, config) {
    if (!indicator || indicator.ema50 === null || indicator.ema200 === null || indicator.adx === null || indicator.highestHigh20 === null) {
        return null;
    }

    const price = candle.close;
    const trendSettings = config.momentumBreakoutStrategy;
    
    const adx = indicator.adx;
    const ema50 = indicator.ema50;
    const ema200 = indicator.ema200;
    const slope = indicator.emaSlope;
    const volume = indicator.volume;
    const volSma = indicator.volSma20;
    const highestHigh = indicator.highestHigh20;
    const lowestLow = indicator.lowestLow20;
    const atr = indicator.atr;

    const volumeConfirmation = volume > (volSma * trendSettings.volumeMultiplier);

    // LONG ENTRY
    if (price > ema200 && ema50 > ema200 && slope > 0 && adx > trendSettings.adxThreshold) {
        if (price > highestHigh && volumeConfirmation) {
            return {
                strategy: 'MOMENTUM_BREAKOUT',
                signal: 'BUY',
                entryPrice: price,
                takeProfitPrice: price + (trendSettings.atrTakeProfitMultiplier * atr),
                stopLossPrice: price - (trendSettings.atrStopMultiplier * atr)
            };
        }
    }

    // SHORT ENTRY (Mirror for Futures)
    if (price < ema200 && ema50 < ema200 && slope < 0 && adx > trendSettings.adxThreshold) {
        if (price < lowestLow && volumeConfirmation) {
            return {
                strategy: 'MOMENTUM_BREAKOUT',
                signal: 'SELL',
                entryPrice: price,
                takeProfitPrice: price - (trendSettings.atrTakeProfitMultiplier * atr),
                stopLossPrice: price + (trendSettings.atrStopMultiplier * atr)
            };
        }
    }

    return null;
}
