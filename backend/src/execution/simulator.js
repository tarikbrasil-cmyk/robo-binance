import { isMarketConditionAllowed, detectMarketRegime } from '../strategy/regime_engine.js';
import { evaluateTrendStrategy } from '../strategy/trend_strategy.js';
import { calculatePositionSize } from '../risk/position_sizing.js';

export function simulateTrade(
    candle, balance, symbol, indicator, prevIndicator, config,
    candles = [], currentIndex = -1, consecutiveWins = 0, maxBalance = 0,
    debugLog = null
) {
    if (!indicator || !prevIndicator) return null;

    // ── 1. Market filter ────────────────────────────────────────────────────
    if (!isMarketConditionAllowed(indicator, candle, config)) return null;

    // ── 2. Strategy ─────────────────────────────────────────────────────────
    const signalData = evaluateTrendStrategy(candle, indicator, prevIndicator, config);
    if (!signalData) return null;

    // ── 2b. Regime detection ─────────────────────────────────────────────────
    const regime = detectMarketRegime(indicator, config);

    // ── 3. Position sizing ─────────────────────────────────────────────────
    // BUG #5 FIX: Read leverage from config instead of hardcoded default
    const leverage = config.trendStrategy?.leverage ?? 5;

    const riskData = calculatePositionSize({
        accountBalance:   balance,
        entryPrice:       signalData.entryPrice,
        atr:              indicator.atr,
        stopATRMultiplier: config.trendStrategy?.atrStopMultiplier ?? 1.5,
        maxLeverage:      leverage,
        currentDrawdown:  maxBalance > 0 ? (maxBalance - balance) / maxBalance : 0,
        maxDrawdownLimit: config.general?.maxDrawdownStop ?? 0.15,
    });

    if (!riskData || riskData.positionSizeUSDT <= 0) return null;

    // ── 4. Entry with slippage ──────────────────────────────────────────────
    // Slippage is applied to the entry price. NOT to be double-counted in fees.
    const spread = config.general?.maxSpreadPercent ?? 0.0005;

    const entry = signalData.signal === 'BUY'
        ? signalData.entryPrice * (1 + spread)
        : signalData.entryPrice * (1 - spread);

    // Adjust TP/SL relative to actual filled entry
    const slipRatio = entry / signalData.entryPrice;
    const adjustedTP = signalData.takeProfitPrice * slipRatio;
    const adjustedSL = signalData.stopLossPrice   * slipRatio;

    // ── 5. Realistic execution ──────────────────────────────────────────────
    const tradeResult = validateTrade(
        candles.slice(currentIndex + 1),
        signalData.signal,
        entry,
        adjustedTP,
        adjustedSL
    );

    // ── 6. Costs ────────────────────────────────────────────────────────────
    // BUG #1/#2 FIX:
    //   - Spread slippage is ALREADY applied to entry price above (no double count)
    //   - Fee is taker fee on notional: 0.04% entry + 0.04% exit = 0.08% round-trip
    //   - Do NOT multiply by spread again here
    const fee = 0.0004; // 0.04% taker fee per side
    const totalFeeRate = fee * 2; // round-trip (entry + exit)

    const gross = riskData.positionSizeUSDT * tradeResult.roe;
    const costs = riskData.positionSizeUSDT * totalFeeRate;
    const net   = gross - costs;

    const newBalance = balance + net;

    // ── 7. BUG #3 FIX: Return complete trade object with all required fields ─
    return {
        symbol,
        side:           signalData.signal,
        strategy:       signalData.strategy,
        regime,
        entryPrice:     entry,
        exitPrice:      tradeResult.exitPrice,
        stopPrice:      adjustedSL,
        takeProfitPrice: adjustedTP,
        roe:            (tradeResult.roe * 100).toFixed(4) + '%',
        pnl:            net.toFixed(4),
        newBalance,
        ts:             candle.ts,
        exitTime:       tradeResult.exitTime,
        candlesElapsed: tradeResult.candlesElapsed,
        riskData,
    };
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
