import { isMarketConditionAllowed, detectMarketRegime } from '../strategy/regime_engine.js';
import { evaluateTrendStrategyProV2 } from '../strategy/TrendFollowing_PRO_V2.js';
import { updateTrailingStop } from '../strategy/trend_strategy_pro.js';
import { calculatePositionSize } from '../risk/position_sizing.js';

export function simulateTrade(
    candle, balance, symbol, indicator, prevIndicator, config,
    candles = [], currentIndex = -1, prevCandle = null, maxBalance = 0,
    currentDailyLoss = 0
) {
    if (!indicator || !prevIndicator) return null;

    // ── 1. Market filter ──────────────────────────────────────────────────
    if (!isMarketConditionAllowed(indicator, candle, config)) return null;

    // ── 2. Regime detection ─────────────────────────────────────────────────
    const regime = detectMarketRegime(indicator, config);

    // ── 3. Strategy PRO V2 ──────────────────────────────────────────────────
    const signalData = evaluateTrendStrategyProV2(candle, prevCandle, indicator, prevIndicator, config, regime, symbol);
    if (!signalData) return null;

    // ── 4. Position sizing ──────────────────────────────────────────────────
    const leverage = config.trendStrategy?.leverage ?? 5;
    const riskData = calculatePositionSize({
        accountBalance:   balance,
        entryPrice:       signalData.entryPrice,
        atr:              indicator.atr,
        stopATRMultiplier: signalData.strategy === 'TREND_V2' ? 1.5 : 1.0, 
        maxLeverage:      leverage,
        currentDrawdown:  maxBalance > 0 ? (maxBalance - balance) / maxBalance : 0,
        maxDrawdownLimit: config.general?.maxDrawdownStop ?? 0.10, // PRO V2: 10% limit
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
        candles.slice(currentIndex + 1),
        signalData.signal,
        entry,
        signalData.takeProfitPrice,
        signalData.stopLossPrice,
        signalData.tp1Price,
        indicator.atr,
        signalData.strategy
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
function validateTradeProV2(futureCandles, side, entry, tpFinal, slInitial, tp1, atr, strategy) {
    let currentSL = slInitial;
    let tp1Hit = false;
    let tp1Time = null;
    let tp1Price = tp1;

    for (let i = 0; i < futureCandles.length; i++) {
        const c = futureCandles[i];

        // [A] TP1 Check (50% exit)
        if (!tp1Hit && tp1Price) {
            const hitTP1 = side === 'BUY' ? c.high >= tp1Price : c.low <= tp1Price;
            if (hitTP1) {
                tp1Hit = true;
                tp1Time = c.ts;
                // Rule: Move SL to Break-even after TP1
                currentSL = entry;
            }
        }

        // [B] Dynamic SL (Trailing) - Active after TP1 for Trend
        if (strategy === 'TREND_V2' && tp1Hit) {
            currentSL = updateTrailingStop({ entryPrice: entry, side, slTarget: currentSL, atr }, c);
        }

        // [C] Final Exit Check
        const hitFinalTP = side === 'BUY' ? c.high >= tpFinal : c.low <= tpFinal;
        const hitSL = side === 'BUY' ? c.low <= currentSL : c.high >= currentSL;

        if (hitFinalTP || hitSL) {
            const exitPrice = hitSL ? currentSL : tpFinal;
            const finalTime = c.ts;
            
            // Calculate Weighted ROE
            const roe1 = tp1Hit ? calculateRoe(side, entry, tp1Price) : calculateRoe(side, entry, exitPrice);
            const roe2 = calculateRoe(side, entry, exitPrice);
            
            // If TP1 hit, total ROE is 50% of ROE1 + 50% of ROE2
            const weightedRoe = tp1Hit ? (0.5 * roe1 + 0.5 * roe2) : roe2;

            return {
                weightedRoe,
                exitPrice,
                exitTime: finalTime,
                candlesElapsed: i + 1,
                tp1Hit
            };
        }
    }

    // Default close
    const last = futureCandles[futureCandles.length - 1] || { close: entry, ts: Date.now() };
    const finalExit = last.close;
    const finalRoe = calculateRoe(side, entry, finalExit);
    const weightedRoe = tp1Hit ? (0.5 * calculateRoe(side, entry, tp1Price) + 0.5 * finalRoe) : finalRoe;

    return { weightedRoe, exitPrice: finalExit, exitTime: last.ts, candlesElapsed: futureCandles.length, tp1Hit };
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
