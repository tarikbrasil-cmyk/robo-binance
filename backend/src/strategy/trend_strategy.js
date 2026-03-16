/**
 * EMA Trend Following Strategy (TRENDING MARKET)
 * 
 * Usada quando regime = TREND
 * LONG ENTRY
 * EMA50 cruza acima da EMA200
 * AND ADX > 25
 * 
 * SHORT ENTRY
 * EMA50 cruza abaixo da EMA200
 * AND ADX > 25
 * 
 * TP = 6%
 * SL = 3%
 */
export function evaluateTrendStrategy(candle, currentIndicator, previousIndicator, config) {
    if (!currentIndicator || currentIndicator.ema50 === null || currentIndicator.ema200 === null || currentIndicator.adx === null) {
        return null;
    }
    if (!previousIndicator || previousIndicator.ema50 === null || previousIndicator.ema200 === null) {
        return null; // Await previous to calc crossing
    }

    const settings = config.trendStrategy;
    
    const ema50 = currentIndicator.ema50;
    const ema200 = currentIndicator.ema200;
    const adx = currentIndicator.adx;
    const prevEma50 = previousIndicator.ema50;
    const prevEma200 = previousIndicator.ema200;
    const price = candle.close;

    const crossBullish = prevEma50 <= prevEma200 && ema50 > ema200;
    const crossBearish = prevEma50 >= prevEma200 && ema50 < ema200;

    if (adx > settings.adxThreshold) {
        if (crossBullish) {
            return {
                strategy: 'EMA_TREND',
                signal: 'BUY',
                entryPrice: price,
                takeProfitPrice: price * (1 + settings.takeProfit),
                stopLossPrice: price * (1 - settings.stopLoss)
            };
        }

        if (crossBearish) {
            return {
                strategy: 'EMA_TREND',
                signal: 'SELL',
                entryPrice: price,
                takeProfitPrice: price * (1 - settings.takeProfit),
                stopLossPrice: price * (1 + settings.stopLoss)
            };
        }
    }

    return null;
}
