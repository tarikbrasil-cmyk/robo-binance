/**
 * STABILIZATION: Simplified Position Sizing
 *
 * Core formula: position_size = (balance * risk_per_trade) / stop_distance_pct
 *
 * BUG #5 FIX: maxLeverage is now always passed explicitly by the caller (simulator.js)
 * using the value from config.trendStrategy.leverage.
 * The default of 5 remains as a safe fallback.
 *
 * Removed: Kelly Criterion, Volatility Scaling, Anti-Martingale
 * Kept: Drawdown gate, min stop distance guard, leverage cap, sanity checks
 */

const MIN_STOP_DISTANCE_PCT = 0.002; // 0.2% minimum stop distance

export function calculatePositionSize({
    accountBalance,
    entryPrice,
    atr,
    stopATRMultiplier = 1.5,
    maxRiskPerTrade = 0.005, // 0.5% default
    maxLeverage = 5,
    currentDrawdown = 0,
    maxDrawdownLimit = 0.10, // PRO V2: 10% Limit
    currentExposureUSDT = 0,
    maxExposureLimit = 0.10, // 10% default
    currentDailyLoss = 0,     // NEW: Cumulative PnL of the day
    maxDailyLossLimit = 0.03, // 3% Limit
}) {
    // ── 0. Drawdown Protection Gate ──
    if (currentDrawdown >= maxDrawdownLimit) {
        const reason = `DRAWDOWN_EXCEEDED (${(currentDrawdown * 100).toFixed(1)}% >= ${(maxDrawdownLimit * 100).toFixed(1)}%)`;
        return { positionSizeUSDT: 0, reason };
    }

    // ── 0.1 Daily Loss Gate ──
    if (currentDailyLoss <= -(accountBalance * maxDailyLossLimit)) {
        const reason = `DAILY_LOSS_EXCEEDED (${(currentDailyLoss).toFixed(2)} <= -${(accountBalance * maxDailyLossLimit).toFixed(2)})`;
        return { positionSizeUSDT: 0, reason };
    }

    // ── 0.2 Exposure Limit Gate ──
    if (currentExposureUSDT >= accountBalance * maxExposureLimit) {
        const reason = `EXPOSURE_LIMIT_REACHED (${(currentExposureUSDT).toFixed(0)} >= ${(accountBalance * maxExposureLimit).toFixed(0)})`;
        return { positionSizeUSDT: 0, reason };
    }

    // ── 1. Risk per trade ──
    const finalRiskPct = maxRiskPerTrade;
    const riskAmountUSDT = accountBalance * finalRiskPct;

    // ── 2. Stop distance from ATR ──
    let stopDistance = 0;
    let stopDistancePct = 0;
    let stopDistanceClipped = false;

    if (atr && atr > 0 && entryPrice > 0) {
        stopDistance = atr * stopATRMultiplier;
        stopDistancePct = stopDistance / entryPrice;
    }

    // Guard: min stop distance 0.2%
    if (stopDistancePct < MIN_STOP_DISTANCE_PCT) {
        stopDistancePct = MIN_STOP_DISTANCE_PCT;
        stopDistance = stopDistancePct * entryPrice;
        stopDistanceClipped = true;
    }

    if (stopDistancePct === 0) {
        return { positionSizeUSDT: 0, reason: 'INVALID_STOP_DISTANCE' };
    }

    // ── 3. Core formula ──
    let positionSizeUSDT = riskAmountUSDT / stopDistancePct;

    // ── 4. Leverage cap and Remaining Exposure ──
    const remainingExposure = (accountBalance * maxExposureLimit) - currentExposureUSDT;
    const maxPositionSizeByLeverage = accountBalance * maxLeverage;
    
    // Size is the minimum of (Risk-based size, Leverage cap, Remaining Exposure)
    let finalPositionSize = Math.min(positionSizeUSDT, maxPositionSizeByLeverage, remainingExposure);
    
    let positionClipped = finalPositionSize < positionSizeUSDT;
    positionSizeUSDT = finalPositionSize;

    // ── 5. Ensure expected loss <= risk amount ──
    // (If clipped by exposure/leverage, loss will be even smaller than riskAmountUSDT)
    let expectedLossUSDT = positionSizeUSDT * stopDistancePct;

    // ── 6. Sanity check ──
    if (!isFinite(positionSizeUSDT) || positionSizeUSDT <= 0) {
        return { positionSizeUSDT: 0, reason: 'CALCULATED_SIZE_INVALID' };
    }

    const positionSizeContracts = positionSizeUSDT / entryPrice;

    return {
        positionSizeUSDT,
        positionSizeContracts,
        accountBalance,
        riskPerTrade: maxRiskPerTrade,
        finalRiskPct,
        riskAmountUSDT,
        expectedLossUSDT,
        stopDistance,
        stopDistancePercent: stopDistancePct,
        stopDistanceClipped,
        leverageUsed: maxLeverage,
        positionClipped,
    };
}
