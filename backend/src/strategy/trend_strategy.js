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
    if (!currentIndicator || currentIndicator.emaFast === null || currentIndicator.emaSlow === null || currentIndicator.adx === null) {
        return null;
    }
    if (!previousIndicator || previousIndicator.emaFast === null || previousIndicator.emaSlow === null) {
        return null; // Await previous to calc crossing
    }

    const settings = config.trendStrategy;
    
    const emaFast = currentIndicator.emaFast;
    const emaSlow = currentIndicator.emaSlow;
    const adx = currentIndicator.adx;
    const prevEmaFast = previousIndicator.emaFast;
    const prevEmaSlow = previousIndicator.emaSlow;
    const price = candle.close;

    const crossBullish = prevEmaFast <= prevEmaSlow && emaFast > emaSlow;
    const crossBearish = prevEmaFast >= prevEmaSlow && emaFast < emaSlow;

    const atr = currentIndicator.atr;

    if (adx > settings.adxThreshold) {
        if (crossBullish) {
            return {
                strategy: 'EMA_TREND',
                signal: 'BUY',
                entryPrice: price,
                takeProfitPrice: price + (atr * settings.atrTakeProfitMultiplier),
                stopLossPrice: price - (atr * settings.atrStopMultiplier)
            };
        }

        if (crossBearish) {
            return {
                strategy: 'EMA_TREND',
                signal: 'SELL',
                entryPrice: price,
                takeProfitPrice: price - (atr * settings.atrTakeProfitMultiplier),
                stopLossPrice: price + (atr * settings.atrStopMultiplier)
            };
        }
    }

    return null;
}
