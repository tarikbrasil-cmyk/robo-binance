/**
 * VWAP Z-Score Mean Reversion (Adaptive V2)
 * 
 * LONG ENTRY:
 * - price > EMA200 (Mean reversion must be in direction of macro trend for safety)
 * - zscore < -2.0
 * - RSI < 30
 * 
 * SHORT ENTRY:
 * - price < EMA200
 * - zscore > 2.0
 * - RSI > 70
 * 
 * EXIT:
 * - TP: VWAP
 * - SL: 2.0 * ATR
 */
export function evaluateVwapZScoreStrategy(candle, indicator, config) {
    if (!indicator || indicator.vwap === null || indicator.atr === null || indicator.rsi === null || indicator.zscore === null) {
        return null;
    }

    const price = candle.close;
    const vwapSettings = config.vwapZScoreStrategy;
    
    const vwap = indicator.vwap;
    const atr = indicator.atr;
    const rsi = indicator.rsi;
    const zscore = indicator.zscore;
    const ema200 = indicator.ema200;

    // LONG ENTRY
    if (price > ema200 && zscore < vwapSettings.zscoreEntryLong && rsi < vwapSettings.rsiOversold) {
        return {
            strategy: 'VWAP_ZSCORE',
            signal: 'BUY',
            entryPrice: price,
            takeProfitPrice: vwap,
            stopLossPrice: price - (vwapSettings.atrStopMultiplier * atr)
        };
    }

    // SHORT ENTRY
    if (price < ema200 && zscore > vwapSettings.zscoreEntryShort && rsi > vwapSettings.rsiOverbought) {
        return {
            strategy: 'VWAP_ZSCORE',
            signal: 'SELL',
            entryPrice: price,
            takeProfitPrice: vwap,
            stopLossPrice: price + (vwapSettings.atrStopMultiplier * atr)
        };
    }

    return null;
}
