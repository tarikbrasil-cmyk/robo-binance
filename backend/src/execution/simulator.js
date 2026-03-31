import { evaluateStrategyV3 } from '../strategy/TrendFollowing_PRO_V3.js';
import { evaluateInstitutionalAlpha } from '../strategy/Institutional_Alpha_V1.js';
import { evaluateRegimeAdaptiveV5 } from '../strategy/RegimeAdaptive_V5.js';
import { updateTrailingStop } from '../strategy/trend_strategy_pro.js';
import { calculatePositionSize } from '../risk/position_sizing.js';
import { detectMarketRegime, detectMarketStructure } from '../strategy/regime_engine.js';
import { evaluateModularStrategyV6, buildModularParamsFromConfig } from '../strategy/ModularStrategyV6.js';

export function simulateTrade(
    candle, balance, symbol, indicator, prevIndicator, config,
    candles = [], currentIndex = -1, prevCandle = null, maxBalance = 0,
    currentDailyLoss = 0, indicators = []
) {
    if (!indicator || !prevIndicator) return null;

    // ── 1. Strategy PRO V3 ──────────────────────────────────────────────────
    const regime = detectMarketRegime(indicator, config);
    
    // ── Choice of Strategy ────────────────────────────────────────────────
    let signalData = null;
    let modularParams = null;
    // Support both config.general.strategyName (new) and config.activeStrategy (legacy)
    const strategyName = config.general?.strategyName || config.activeStrategy || 'INSTITUTIONAL_ALPHA';

    if (strategyName.startsWith('MODULAR_V6') || strategyName.startsWith('PROMOTED_')) {
        modularParams = buildModularParamsFromConfig(config);
        signalData = evaluateModularStrategyV6(candles, indicators, currentIndex, modularParams, symbol);
    } else if (strategyName === 'V5' || strategyName === 'REGIME_ADAPTIVE_V5') {
        signalData = evaluateRegimeAdaptiveV5(candles, indicators, currentIndex, config, symbol);
    } else if (strategyName === 'V3') {
        signalData = evaluateStrategyV3(candles, indicators, currentIndex, config, symbol);
    } else {
        signalData = evaluateInstitutionalAlpha(candles, indicators, currentIndex, config, symbol);
    }

    if (!signalData) return null;

    // ── 4. Position sizing ──────────────────────────────────────────────────
    const leverage = config.trendStrategy?.leverage ?? 5;
    
    // Determine the actual ATR multiplier used for SL to ensure position sizing is accurate
    let stopMult = 1.5;
    if (modularParams) {
        stopMult = modularParams.atrMultiplier;
    } else if (signalData.strategy.includes('V3')) {
        stopMult = 2.0;
    } else if (signalData.strategy.includes('INSTITUTIONAL')) {
        stopMult = 3.0; // Matches buildInstitutionalSignal SL mult
    } else if (signalData.strategy === 'REGIME_ADAPTIVE_V5') {
        stopMult = 1.5; // Matches buildSignalV5 SL mult
    }

    const riskPerTrade = modularParams
        ? (config.risk?.maxRiskPerTrade ?? 0.02)
        : (signalData.strategy === 'REGIME_ADAPTIVE_V5' ? 0.003 : (config.risk?.risk_per_trade ?? 0.005));

    const riskData = calculatePositionSize({
        accountBalance:   balance,
        entryPrice:       signalData.entryPrice,
        atr:              indicator.atr,
        stopATRMultiplier: stopMult, 
        maxRiskPerTrade:  riskPerTrade,
        maxLeverage:      leverage,
        currentDrawdown:  maxBalance > 0 ? (maxBalance - balance) / maxBalance : 0,
        maxDrawdownLimit: config.general?.maxDrawdownStop ?? 0.08, 
        currentDailyLoss: currentDailyLoss,
    });

    if (!riskData || riskData.positionSizeUSDT <= 0) return null;

    // ── 5. Entry with slippage ──────────────────────────────────────────────
    const spread = config.general?.maxSpreadPercent ?? 0.0005;
    const entry = signalData.signal === 'BUY'
        ? signalData.entryPrice * (1 + spread)
        : signalData.entryPrice * (1 - spread);

    // ── 6. Realistic validation with Partial Exits (TP1) ───────────────────
    const tradeResult = validateTradeProV2(
        candles,
        signalData.signal,
        entry,
        signalData.takeProfitPrice,
        signalData.stopLossPrice,
        signalData.tp1Price,
        indicator.atr,
        signalData.strategy,
        currentIndex
    );

    // ── 7. PnL Calculation ──────────────────────────────────────────────────
    const fee = 0.0004; 
    const totalFeeRate = fee * 2; 

    const gross = riskData.positionSizeUSDT * tradeResult.weightedRoe * leverage;
    const costs = riskData.positionSizeUSDT * totalFeeRate * leverage;
    const net   = gross - costs;

    return {
        symbol,
        side:           signalData.signal,
        strategy:       signalData.strategy,
        regime,
        entryPrice:     entry,
        exitPrice:      tradeResult.exitPrice,
        pnl:            net.toFixed(4),
        roe:            (tradeResult.weightedRoe * leverage * 100).toFixed(4) + '%',
        newBalance:     balance + net,
        ts:             candle.ts,
        exitTime:       tradeResult.exitTime,
        candlesElapsed: tradeResult.candlesElapsed,
        riskData
    };
}

/**
 * PRO V2 VALIDATOR: Multi-stage exits (TP1, Trailing, SL)
 */
function validateTradeProV2(allCandles, side, entry, tpFinal, slInitial, tp1, atr, strategy, startIndex) {
    let currentSL = slInitial;
    let tp1Hit = false;
    let tp1Price = tp1;

    const futureCandles = allCandles.slice(startIndex + 1);

    for (let i = 0; i < futureCandles.length; i++) {
        const c = futureCandles[i];
        const currentGlobalIdx = startIndex + 1 + i;

        // [A] TP1 Check (50% exit)
        if (!tp1Hit && tp1Price) {
            const hitTP1 = side === 'BUY' ? c.high >= tp1Price : c.low <= tp1Price;
            if (hitTP1) {
                tp1Hit = true;
                // Rule: Move SL to Break-even after TP1
                currentSL = entry;
            }
        }

        // [B] Dynamic SL (Trailing) - Active after TP1 for Trend V2 & V3
        if (strategy.includes('TREND') && tp1Hit) {
            currentSL = updateTrailingStop({ entryPrice: entry, side, slTarget: currentSL, atr }, c);
        }

        // [C] Structure Loss Exit (V3)
        if (strategy === 'TREND_PRO_V3') {
            const structure = detectMarketStructure(allCandles, currentGlobalIdx, 20);
            
            const isLoss = side === 'BUY' 
                ? (structure === 'BEARISH_STRUCTURE' || structure === 'CHOPPY')
                : (structure === 'BULLISH_STRUCTURE' || structure === 'CHOPPY');

            if (isLoss) {
                // Return immediate exit
                return buildResultV2(side, entry, c.close, c.ts, i + 1, tp1Hit, tp1Price, currentSL);
            }
        }

        // [D] Final Exit Check (STRICT INTRABAR)
        const hitFinalTP = side === 'BUY' ? c.high >= tpFinal : c.low <= tpFinal;
        const hitSL = side === 'BUY' ? c.low <= currentSL : c.high >= currentSL;

        if (hitFinalTP && hitSL) {
            // Ambiguous/Intrabar: Prioritize SL for institutional conservatism (Loss)
            return buildResultV2(side, entry, currentSL, c.ts, i + 1, tp1Hit, tp1Price, currentSL);
        }

        if (hitSL) {
            return buildResultV2(side, entry, currentSL, c.ts, i + 1, tp1Hit, tp1Price, currentSL);
        }
        
        if (hitFinalTP) {
            return buildResultV2(side, entry, tpFinal, c.ts, i + 1, tp1Hit, tp1Price, currentSL);
        }

        // [E] New RISK MANAGEMENT (V5): Break-even and Trailing
        if (strategy === 'REGIME_ADAPTIVE_V5') {
            const risk = Math.abs(entry - slInitial);
            const currentGain = side === 'BUY' ? (c.close - entry) : (entry - c.close);
            
            // Break-even at +1R
            if (currentGain >= risk && currentSL !== entry) {
                currentSL = entry;
            }
            
            // Trailing Stop after +1.5R (Lock in 1R gain approx)
            if (currentGain >= risk * 1.5) {
                const lockPrice = side === 'BUY' ? (entry + (risk * 0.7)) : (entry - (risk * 0.7)); // conservative lock
                if (side === 'BUY' ? currentSL < lockPrice : currentSL > lockPrice) {
                    currentSL = lockPrice;
                }
            }
        }
    }

    // Default close
    const last = futureCandles[futureCandles.length - 1] || { close: entry, ts: Date.now() };
    return buildResultV2(side, entry, last.close, last.ts, futureCandles.length, tp1Hit, tp1Price, currentSL);
}

function buildResultV2(side, entry, exitPrice, exitTime, candlesElapsed, tp1Hit, tp1Price, currentSL) {
    const roe1 = tp1Hit ? calculateRoe(side, entry, tp1Price) : calculateRoe(side, entry, exitPrice);
    const roe2 = calculateRoe(side, entry, exitPrice);
    const weightedRoe = tp1Hit ? (0.5 * roe1 + 0.5 * roe2) : roe2;

    return {
        weightedRoe,
        exitPrice,
        exitTime,
        candlesElapsed,
        tp1Hit
    };
}

function calculateRoe(side, entry, exit) {
    return side === 'BUY' ? (exit - entry) / entry : (entry - exit) / entry;
}

/**
 * PRO VALIDATOR: Handles Trailing Stop and Ambiguous Candles
 */
function validateTradePro(futureCandles, side, entry, tp, sl, atr) {
    let currentSL = sl;

    for (let i = 0; i < futureCandles.length; i++) {
        const c = futureCandles[i];

        // 1. Update Trailing Stop based on price
        currentSL = updateTrailingStop({ entryPrice: entry, side, slTarget: currentSL, atr }, c);

        // 2. Check targets
        const hitTP = side === 'BUY' ? c.high >= tp : c.low <= tp;
        const hitSL = side === 'BUY' ? c.low <= currentSL : c.high >= currentSL;

        if (hitTP && hitSL) {
            // Ambiguous candle: prioritize SL for conservatism
            return buildResult(side, entry, currentSL, c.ts, i + 1);
        }

        if (hitTP) return buildResult(side, entry, tp, c.ts, i + 1);
        if (hitSL) return buildResult(side, entry, currentSL, c.ts, i + 1);
    }

    // Fallback: close at end of data
    const last = futureCandles[futureCandles.length - 1];
    if (!last) return { win: false, roe: 0, exitPrice: entry, exitTime: Date.now(), candlesElapsed: 1 };
    return buildResult(side, entry, last.close, last.ts, futureCandles.length);
}

// 🔥 CORE FIXED ENGINE
function validateTrade(futureCandles, side, entry, tp, sl) {
    for (let i = 0; i < futureCandles.length; i++) {
        const c = futureCandles[i];

        const hitTP = side === 'BUY'
            ? c.high >= tp
            : c.low  <= tp;

        const hitSL = side === 'BUY'
            ? c.low  <= sl
            : c.high >= sl;

        // 🧠 CASO AMBÍGUO (os dois no mesmo candle)
        if (hitTP && hitSL) {
            // comportamento realista conservador:
            // assume que o pior cenário aconteceu
            return buildResult(side, entry, sl, c.ts, i + 1);
        }

        if (hitTP) {
            return buildResult(side, entry, tp, c.ts, i + 1);
        }

        if (hitSL) {
            return buildResult(side, entry, sl, c.ts, i + 1);
        }
    }

    // 🟡 FALLBACK: Trade não fechou por TP/SL — fecha no último candle disponível
    const last = futureCandles[futureCandles.length - 1];

    if (!last) {
        return {
            win: false,
            roe: 0,
            exitPrice: entry,
            exitTime: Date.now(),
            candlesElapsed: 1
        };
    }

    const exit = last.close;
    return buildResult(side, entry, exit, last.ts, futureCandles.length);
}

// 🧠 PnL CORRETO E CENTRALIZADO
function buildResult(side, entry, exit, time, candlesElapsed) {
    const roe = side === 'BUY'
        ? (exit - entry) / entry
        : (entry - exit) / entry;

    return {
        win: roe > 0,
        roe,
        exitPrice: exit,
        exitTime: time,
        candlesElapsed
    };
}
