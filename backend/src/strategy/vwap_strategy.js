/**
 * VWAP Mean Reversion Strategy (RANGING MARKET)
 * 
 * Usada quando regime = RANGE
 * LONG ENTRY
 * price < VWAP - 1.0 * ATR
 * AND RSI < 35
 * 
 * SHORT ENTRY
 * price > VWAP + 1.0 * ATR
 * AND RSI > 65
 * 
 * TP = VWAP
 * SL = Entry +/- 1 ATR
 */
export function evaluateVwapStrategy(candle, indicator, config) {
    if (!indicator || indicator.vwap === null || indicator.atr === null || indicator.rsi === null) {
        return null;
    }

    const price = candle.close;
    const vwapStrategyConfig = config.vwapStrategy;
    
    const vwap = indicator.vwap;
    const atr = indicator.atr;
    const rsi = indicator.rsi;
    const atrUpperBand = vwap + (vwapStrategyConfig.atrThresholdMultiplier * atr);
    const atrLowerBand = vwap - (vwapStrategyConfig.atrThresholdMultiplier * atr);

    // LONG ENTRY
    if (price < atrLowerBand && rsi < vwapStrategyConfig.rsiOversold) {
        return {
            strategy: 'VWAP_MEAN_REVERSION',
            signal: 'BUY',
            entryPrice: price,
            takeProfitPrice: vwap,
            stopLossPrice: price - (vwapStrategyConfig.stopLossAtrMultiplier * atr)
        };
    }

    // SHORT ENTRY
    if (price > atrUpperBand && rsi > vwapStrategyConfig.rsiOverbought) {
        return {
            strategy: 'VWAP_MEAN_REVERSION',
            signal: 'SELL',
            entryPrice: price,
            takeProfitPrice: vwap,
            stopLossPrice: price + (vwapStrategyConfig.stopLossAtrMultiplier * atr)
        };
    }

    return null;
}
