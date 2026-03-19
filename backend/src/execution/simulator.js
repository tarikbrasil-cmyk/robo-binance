import { isMarketConditionAllowed, detectMarketRegime } from '../strategy/regime_engine.js';
import { evaluateTrendStrategyPro, updateTrailingStop } from '../strategy/trend_strategy_pro.js';
import { calculatePositionSize } from '../risk/position_sizing.js';

export function simulateTrade(
    candle, balance, symbol, indicator, prevIndicator, config,
    candles = [], currentIndex = -1, consecutiveWins = 0, maxBalance = 0,
    debugLog = null
) {
    if (!indicator || !prevIndicator) return null;

    // ── 1. Market filter (UTC Time, etc.) ──────────────────────────────────
    if (!isMarketConditionAllowed(indicator, candle, config)) return null;

    // ── 2. Regime detection ─────────────────────────────────────────────────
    const regime = detectMarketRegime(indicator, config);

    // ── 3. Strategy PRO V1 ──────────────────────────────────────────────────
    const signalData = evaluateTrendStrategyPro(candle, indicator, prevIndicator, config, regime, symbol);
    if (!signalData) return null;

    // ── 4. Position sizing ──────────────────────────────────────────────────
    const leverage = config.trendStrategy?.leverage ?? 5;

    const riskData = calculatePositionSize({
        accountBalance:   balance,
        entryPrice:       signalData.entryPrice,
        atr:              indicator.atr,
        stopATRMultiplier: 1.5, // PRO V1 Fixed
        maxLeverage:      leverage,
        currentDrawdown:  maxBalance > 0 ? (maxBalance - balance) / maxBalance : 0,
        maxDrawdownLimit: config.general?.maxDrawdownStop ?? 0.15,
    });

    if (!riskData || riskData.positionSizeUSDT <= 0) return null;

    // ── 5. Entry with slippage ──────────────────────────────────────────────
    const spread = config.general?.maxSpreadPercent ?? 0.0005;

    const entry = signalData.signal === 'BUY'
        ? signalData.entryPrice * (1 + spread)
        : signalData.entryPrice * (1 - spread);

    // Initial targets from strategy (adjusted by slippage)
    const delta = entry - signalData.entryPrice;
    const initialTP = signalData.takeProfitPrice + delta;
    const initialSL = signalData.stopLossPrice   + delta;

    // ── 6. Realistic execution with Trailing Stop ───────────────────────────
    const tradeResult = validateTradePro(
        candles.slice(currentIndex + 1),
        signalData.signal,
        entry,
        initialTP,
        initialSL,
        indicator.atr // passed for trailing logic
    );

    // ── 7. Costs ────────────────────────────────────────────────────────────
    const fee = 0.0004; // 0.04% taker fee per side
    const totalFeeRate = fee * 2; 

    const gross = riskData.positionSizeUSDT * tradeResult.roe;
    const costs = riskData.positionSizeUSDT * totalFeeRate;
    const net   = gross - costs;

    const newBalance = balance + net;

    return {
        symbol,
        side:           signalData.signal,
        strategy:       signalData.strategy,
        regime,
        entryPrice:     entry,
        exitPrice:      tradeResult.exitPrice,
        stopPrice:      initialSL,
        takeProfitPrice: initialTP,
        roe:            (tradeResult.roe * 100).toFixed(4) + '%',
        pnl:            net.toFixed(4),
        newBalance,
        ts:             candle.ts,
        exitTime:       tradeResult.exitTime,
        candlesElapsed: tradeResult.candlesElapsed,
        riskData,
    };
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
