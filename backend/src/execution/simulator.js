import { isMarketConditionAllowed } from '../strategy/regime_engine.js';
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

    // ── 3. Position sizing ─────────────────────────────────────────────────
    const riskData = calculatePositionSize({
        accountBalance: balance,
        entryPrice: signalData.entryPrice,
        atr: indicator.atr,
        stopATRMultiplier: config.trendStrategy?.atrStopMultiplier ?? 1.5,
        config,
        indicator,
        historicalWinRate: 0.55,
        historicalRewardRisk: 1.5,
        consecutiveWins,
        currentDrawdown: maxBalance > 0 ? (maxBalance - balance) / maxBalance : 0,
    });

    if (riskData.positionSizeUSDT <= 0) return null;

    // ── 4. Entry with slippage ──────────────────────────────────────────────
    const spread = config.general?.maxSpreadPercent ?? 0.0005;

    const entry = signalData.signal === 'BUY'
        ? signalData.entryPrice * (1 + spread)
        : signalData.entryPrice * (1 - spread);

    // ── 5. Realistic execution ──────────────────────────────────────────────
    const tradeResult = validateTrade(
        candles.slice(currentIndex + 1),
        signalData.signal,
        entry,
        signalData.takeProfitPrice,
        signalData.stopLossPrice
    );

    // ── 6. Costs ────────────────────────────────────────────────────────────
    const fee = 0.0004;
    const totalCostRate = (fee + spread) * 2;

    const gross = riskData.positionSizeUSDT * tradeResult.roe;
    const costs = riskData.positionSizeUSDT * totalCostRate;
    const net   = gross - costs;

    const newBalance = balance + net;

    return {
        symbol,
        side: signalData.signal,
        entryPrice: entry,
        exitPrice: tradeResult.exitPrice,
        roe: (tradeResult.roe * 100).toFixed(4) + '%',
        pnl: net.toFixed(4),
        newBalance,
        ts: candle.ts,
    };
}

// 🔥 CORE FIXED ENGINE
function validateTrade(futureCandles, side, entry, tp, sl) {
    for (let i = 0; i < futureCandles.length; i++) {
        const c = futureCandles[i];

        const hitTP = side === 'BUY'
            ? c.high >= tp
            : c.low <= tp;

        const hitSL = side === 'BUY'
            ? c.low <= sl
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

    // 🟡 FALLBACK CORRIGIDO (ANTES ERA O BUG)
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
