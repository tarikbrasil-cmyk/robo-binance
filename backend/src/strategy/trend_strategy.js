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
export function evaluateTrendStrategy(candle, currentIndicator, previousIndicator, config, regime = 'TREND') {
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

    // ── Continuity (Pullback) Logic ──
    // If already in trend and price touches EMA support/resistance
    const isBullishTrend = emaFast > emaSlow && adx > settings.adxThreshold;
    const isBearishTrend = emaFast < emaSlow && adx > settings.adxThreshold;
    
    // Pullback criteria: price low/high near EMA and RSI not extreme
    const pullbackLong = isBullishTrend && candle.low <= emaFast * 1.001 && price > emaFast && currentIndicator.rsi < 65;
    const pullbackShort = isBearishTrend && candle.high >= emaFast * 0.999 && price < emaFast && currentIndicator.rsi > 35;

    const atr = currentIndicator.atr;

    // ── Final Signal Decision ──
    if (regime === 'TREND') {
        if (crossBullish || pullbackLong) {
            return {
                strategy: crossBullish ? 'EMA_CROSS' : 'EMA_PULLBACK',
                signal: 'BUY',
                entryPrice: price,
                takeProfitPrice: price + (atr * settings.atrTakeProfitMultiplier),
                stopLossPrice: price - (atr * settings.atrStopMultiplier)
            };
        }

        if (crossBearish || pullbackShort) {
            return {
                strategy: crossBearish ? 'EMA_CROSS' : 'EMA_PULLBACK',
                signal: 'SELL',
                entryPrice: price,
                takeProfitPrice: price - (atr * settings.atrTakeProfitMultiplier),
                stopLossPrice: price + (atr * settings.atrStopMultiplier)
            };
        }
    }

    return null;
}
