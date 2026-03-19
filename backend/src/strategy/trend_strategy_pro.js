/**
 * TREND FOLLOWING PRO V1
 * 
 * Strict "Anti-Chop" Strategy with Momentum and Volatility filters.
 * Ensures high consistency between Backtest and Live.
 */

const cooldowns = {}; // symbol -> lastTradeTs

export function evaluateTrendStrategyPro(candle, indicator, prevIndicator, config, regime, symbol) {
    if (!indicator || !prevIndicator) return null;

    // ── 0. COOLDOWN CHECK ───────────────────────────────────────────────────
    const lastTradeTs = cooldowns[symbol] || 0;
    const cooldownMs = (config.general?.cooldownMinutes || 30) * 60 * 1000;
    if (candle.ts - lastTradeTs < cooldownMs) return null;

    // ── 1. TREND DIRECTION (EMA 50/200) ─────────────────────────────────────
    const ema50 = indicator.emaFast;
    const ema200 = indicator.emaSlow;
    if (!ema50 || !ema200) return null;

    const isBullish = ema50 > ema200;
    const isBearish = ema50 < ema200;

    // ── 2. ANTI-CHOP (ADX >= 30) ────────────────────────────────────────────
    if (indicator.adx < 30) return null;

    // ── 3. EMA 200 DISTANCE (Min 0.2%) ──────────────────────────────────────
    const dist200 = Math.abs(candle.close - ema200) / ema200;
    if (dist200 < 0.002) return null;

    // ── 4. MOMENTUM (RSI) ───────────────────────────────────────────────────
    const rsi = indicator.rsi;
    const isRsiOk = isBullish ? (rsi > 55) : (rsi < 45);
    if (!isRsiOk) return null;

    // ── 5. VOLUME CONFIRMATION ──────────────────────────────────────────────
    if (indicator.volume <= indicator.volSma) return null;

    // ── 6. VOLATILITY FILTER (ATR/Price >= 0.1%) ────────────────────────────
    if (indicator.atrPercent < 0.001) return null;

    // ── 7. TIMING (Pullback to EMA 50) ──────────────────────────────────────
    // Price must be close to EMA 50 (dist <= 1.5 ATR)
    const dist50 = Math.abs(candle.close - ema50);
    const maxDist = indicator.atr * 1.5;
    if (dist50 > maxDist) return null;

    // ── 8. SIGNAL GENERATION ────────────────────────────────────────────────
    const signal = isBullish ? 'BUY' : 'SELL';
    
    // Stop Loss: 1.5 ATR
    // Take Profit: 3.0 ATR
    const slDistance = indicator.atr * 1.5;
    const tpDistance = indicator.atr * 3.0;

    const stopLossPrice = signal === 'BUY' 
        ? candle.close - slDistance 
        : candle.close + slDistance;
    
    const takeProfitPrice = signal === 'BUY' 
        ? candle.close + tpDistance 
        : candle.close - tpDistance;

    // Record cooldown
    cooldowns[symbol] = candle.ts;

    return {
        symbol,
        signal,
        strategy: 'TREND_PRO_V1',
        entryPrice: candle.close,
        stopLossPrice,
        takeProfitPrice,
        indicator,
        atr: indicator.atr // helper for trailing logic
    };
}

/**
 * Trailing Stop Logic:
 * 1. Profit >= 1 ATR -> Breakeven
 * 2. Profit >= 2 ATR -> Trailing at 1 ATR distance
 */
export function updateTrailingStop(position, currentCandle) {
    if (!position || !position.entryPrice) return position.slTarget;

    const { entryPrice, side, atr } = position;
    const currentPrice = currentCandle.close;
    let currentSl = position.slTarget;

    if (side === 'BUY') {
        const profit = currentPrice - entryPrice;
        
        // Tier 2: Trailing (Profit >= 2 ATR)
        if (profit >= atr * 2) {
            const newSl = currentPrice - atr;
            if (newSl > currentSl) currentSl = newSl;
        } 
        // Tier 1: Breakeven (Profit >= 1 ATR)
        else if (profit >= atr) {
            if (entryPrice > currentSl) currentSl = entryPrice;
        }
    } else { // SELL
        const profit = entryPrice - currentPrice;
        
        if (profit >= atr * 2) {
            const newSl = currentPrice + atr;
            if (newSl < currentSl) currentSl = newSl;
        } else if (profit >= atr) {
            if (entryPrice < currentSl) currentSl = entryPrice;
        }
    }

    return currentSl;
}
