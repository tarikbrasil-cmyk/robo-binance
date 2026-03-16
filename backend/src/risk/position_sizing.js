/**
 * src/risk/position_sizing.js
 *
 * Risk-based position sizing with Kelly Criterion, Volatility Scaling,
 * Anti-Martingale, Drawdown protection, and hard-cap audit guards.
 *
 * Formula:
 *   riskAmountUSDT     = accountBalance × finalRiskPct
 *   stopDistancePct    = ATR × stopATRMultiplier / entryPrice  (min 0.2%)
 *   positionSizeUSDT   = riskAmountUSDT / stopDistancePct
 *   positionSizeUSDT   = min(positionSizeUSDT, accountBalance × maxLeverage)
 *   expectedLossUSDT   = positionSizeUSDT × stopDistancePct   (hard-clipped to riskAmountUSDT)
 */

/** Minimum stop distance to prevent position explosion when ATR is tiny */
const MIN_STOP_DISTANCE_PCT = 0.002; // 0.2%

export function calculatePositionSize({
    accountBalance,
    entryPrice,
    atr,                          // current ATR value
    stopATRMultiplier,            // e.g. 1.0 from vwapStrategy.stopLossAtrMultiplier
    config,
    indicator,                    // full indicator object for volatility scaling
    historicalWinRate = 0.55,
    historicalRewardRisk = 1.5,
    consecutiveWins = 0,
    currentDrawdown = 0           // fraction, e.g. 0.15 for 15%
}) {
    // ─── 0. Drawdown Protection Stop ───────────────────────────────────────────
    const maxGlobalDrawdown = config.general?.maxDrawdownStop ?? 0.25;
    if (currentDrawdown >= maxGlobalDrawdown) {
        return { positionSizeUSDT: 0, reason: 'SYSTEM_DRAWDOWN_EXCEEDED' };
    }

    // ─── 1. Kelly Criterion (Half-Kelly) ───────────────────────────────────────
    const W = historicalWinRate;
    const R = historicalRewardRisk;
    const kellyFraction = W - (1 - W) / R;
    let positionRisk = kellyFraction > 0 ? kellyFraction * 0.5 : 0.01; // fallback 1%

    // ─── 2. Risk Cap ────────────────────────────────────────────────────────────
    const maxRisk = config.risk?.maxRiskPerTrade ?? 0.02;
    positionRisk = Math.min(positionRisk, maxRisk);

    // ─── 3. Drawdown Scaling ────────────────────────────────────────────────────
    if (currentDrawdown >= 0.20) {
        positionRisk *= 0.50;
    } else if (currentDrawdown >= 0.10) {
        positionRisk *= 0.75;
    }

    // ─── 4. Volatility Scaling ──────────────────────────────────────────────────
    let volMultiplier = 1.0;
    let volatilityFactor = 1.0;
    if (indicator?.atr && indicator?.atrSma100) {
        volatilityFactor = indicator.atr / indicator.atrSma100;
        if (volatilityFactor > 2.0)       volMultiplier = 0.25;
        else if (volatilityFactor > 1.5)  volMultiplier = 0.50;
        else if (volatilityFactor < 0.7)  volMultiplier = 1.20;
    }

    // ─── 5. Anti-Martingale ─────────────────────────────────────────────────────
    if (consecutiveWins >= 3) volMultiplier *= 1.25;

    // ─── 6. Final Risk % (hard-capped again after scaling) ─────────────────────
    let finalRiskPct = Math.min(positionRisk * volMultiplier, maxRisk);

    // ─── 7. Risk Amount ─────────────────────────────────────────────────────────
    const riskAmountUSDT = accountBalance * finalRiskPct;

    // ─── 8. Stop Distance ───────────────────────────────────────────────────────
    // Use ATR-based stop distance (same multiplier used by the strategy for SL price)
    const effectiveATR = atr ?? indicator?.atr;
    const effectiveMultiplier = stopATRMultiplier
        ?? config.vwapStrategy?.stopLossAtrMultiplier
        ?? 1.0;

    let stopDistance = 0;
    let stopDistancePct = 0;
    let stopDistanceClipped = false;

    if (effectiveATR && effectiveATR > 0 && entryPrice > 0) {
        stopDistance = effectiveATR * effectiveMultiplier;
        stopDistancePct = stopDistance / entryPrice;
    }

    // Guard: minimum stop distance 0.2% to prevent position explosion
    if (stopDistancePct < MIN_STOP_DISTANCE_PCT) {
        stopDistancePct = MIN_STOP_DISTANCE_PCT;
        stopDistance = stopDistancePct * entryPrice;
        stopDistanceClipped = true;
    }

    if (stopDistancePct === 0) {
        return { positionSizeUSDT: 0, reason: 'INVALID_STOP_DISTANCE' };
    }

    // ─── 9. Position Size ───────────────────────────────────────────────────────
    let positionSizeUSDT = riskAmountUSDT / stopDistancePct;

    // ─── 10. Absolute Leverage Cap ──────────────────────────────────────────────
    const leverage = config.trendStrategy?.leverage ?? 10;
    const maxPositionSizeUSDT = accountBalance * leverage;
    let positionClippedByLeverageCap = false;

    if (positionSizeUSDT > maxPositionSizeUSDT) {
        positionSizeUSDT = maxPositionSizeUSDT;
        positionClippedByLeverageCap = true;
    }

    // ─── 11. Hard Guard: ensure actual expected loss ≤ riskAmountUSDT ──────────
    let expectedLossUSDT = positionSizeUSDT * stopDistancePct;
    if (expectedLossUSDT > riskAmountUSDT) {
        positionSizeUSDT = riskAmountUSDT / stopDistancePct;
        expectedLossUSDT = riskAmountUSDT; // now exact
    }

    // Final sanity
    if (!isFinite(positionSizeUSDT) || positionSizeUSDT <= 0) {
        return { positionSizeUSDT: 0, reason: 'CALCULATED_SIZE_INVALID' };
    }

    const positionSizeContracts = positionSizeUSDT / entryPrice;

    return {
        // Core sizing
        positionSizeUSDT,
        positionSizeContracts,

        // Risk breakdown
        accountBalance,
        riskPerTrade: maxRisk,
        finalRiskPct,
        riskAmountUSDT,
        expectedLossUSDT,

        // Stop info
        stopDistance,
        stopDistancePercent: stopDistancePct,
        stopDistanceClipped,

        // Leverage
        leverageUsed: leverage,
        positionClippedByLeverageCap,

        // Diagnostics
        kellyFractionApplied: kellyFraction,
        volatilityFactor,
    };
}
