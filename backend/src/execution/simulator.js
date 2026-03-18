import { detectMarketRegime, isMarketConditionAllowed } from '../strategy/regime_engine.js';
import { evaluateTrendStrategy } from '../strategy/trend_strategy.js';
import { evaluateVwapStrategy } from '../strategy/vwap_strategy.js';
import { calculatePositionSize } from '../risk/position_sizing.js';

/**
 * Build a per-candle debug entry capturing every filter decision.
 */
function buildDebugEntry(candle, indicator, config, reason, regimeDetected) {
    const vwap = indicator?.vwap ?? null;
    const price = candle?.close ?? null;
    const vwapDistance = (vwap !== null && price !== null && indicator?.atr)
        ? Math.abs(price - vwap) / indicator.atr
        : null;

    return {
        timestamp:       candle?.ts ?? null,
        price,
        regimeDetected:  regimeDetected ?? 'UNKNOWN',
        rsi:             indicator?.rsi ?? null,
        adx:             indicator?.adx ?? null,
        atr:             indicator?.atr ?? null,
        vwapDistance,
        volume:          indicator?.volume ?? null,
        volumeSMA:       indicator?.volSma20 ?? null,
        spread:          config?.general?.maxSpreadPercent ?? null,
        entryAllowed:    false,
        reasonBlocked:   reason,
    };
}

/**
 * simulateTrade
 *
 * Returns a trade result object, or null if no trade was taken.
 * When null, a debug entry is pushed into `debugLog` (if provided).
 *
 * @param {Object}  candle
 * @param {number}  balance
 * @param {string}  symbol
 * @param {Object}  indicator      - current candle's indicator object
 * @param {Object}  prevIndicator
 * @param {Object}  config         - strategy_config.json parsed object
 * @param {Array}   candles        - full candle array (for realistic path validation)
 * @param {number}  currentIndex
 * @param {number}  consecutiveWins
 * @param {number}  maxBalance
 * @param {Array}   [debugLog]     - optional array; debug entry is pushed when no trade taken
 */
export function simulateTrade(
    candle, balance, symbol, indicator, prevIndicator, config,
    candles = [], currentIndex = -1, consecutiveWins = 0, maxBalance = 0,
    debugLog = null
) {
    if (!indicator || !prevIndicator) return null;

    // ── 1. Global market condition filter (volume, time) ─────────────────────
    if (!isMarketConditionAllowed(indicator, candle, config)) {
        if (debugLog) {
            const vol = indicator.volume ?? 0;
            const volSma = indicator.volSma20 ?? 0;
            const reason = vol <= volSma * 0.8 ? 'LOW_VOLUME' : 'REGIME_FILTER';
            debugLog.push(buildDebugEntry(candle, indicator, config, reason, 'N/A'));
        }
        return null;
    }

    // ── 2. Market Regime (V1: Unified Trend Strategy) ────────────────────────
    const regime = 'TREND'; 

    // ── 3. Strategy Signal ───────────────────────────────────────────────────
    const signalData = evaluateTrendStrategy(candle, indicator, prevIndicator, config);

    if (!signalData) {
        if (debugLog) {
            debugLog.push(buildDebugEntry(candle, indicator, config, 'NO_SIGNAL', regime));
        }
        return null;
    }

    // ── 4. Risk-based Position Sizing ────────────────────────────────────────
    const currentDrawdown = maxBalance > 0 ? (maxBalance - balance) / maxBalance : 0;

    const riskData = calculatePositionSize({
        accountBalance:       balance,
        entryPrice:           signalData.entryPrice,
        atr:                  indicator.atr,
        stopATRMultiplier:    config.trendStrategy?.atrStopMultiplier ?? 1.5,
        config,
        indicator,
        historicalWinRate:    0.55,
        historicalRewardRisk: 1.5,
        consecutiveWins,
        currentDrawdown,
    });

    if (riskData.positionSizeUSDT <= 0) {
        if (debugLog) {
            const reason = riskData.reason === 'STOP_TOO_SMALL' ? 'STOP_TOO_SMALL' : 'RISK_LIMIT';
            debugLog.push(buildDebugEntry(candle, indicator, config, reason, regime));
        }
        return null;
    }

    // ── 4b. Use RAW Strategy SL/TP Targets ───────────────────────────────────
    // As per critical mandate: Backtest MUST NOT recalculate TP/SL.
    // Ensure we are strictly using the strategy's targets.
    const tpTarget = signalData.takeProfitPrice;
    const slTarget = signalData.stopLossPrice;


    // ── 5. Entry Slippage ────────────────────────────────────────────────────
    const entrySlippagePct = config.general?.maxSpreadPercent ?? 0.0005;
    const slippageAdjustedEntry = signalData.signal === 'BUY'
        ? signalData.entryPrice * (1 + entrySlippagePct)
        : signalData.entryPrice * (1 - entrySlippagePct);

    // ── 6. Realistic Path Validation ─────────────────────────────────────────
    let tradeResult;
    if (candles.length > 0 && currentIndex !== -1) {
        tradeResult = validateAbsoluteTradeRealistically(
            candles.slice(currentIndex + 1),
            signalData.signal,
            slippageAdjustedEntry,
            signalData.takeProfitPrice,
            signalData.stopLossPrice
        );
    } else {
        tradeResult = {
            win: false,
            roe: 0,
            exitPrice: slippageAdjustedEntry,
            exitTime: candle.ts + 60000,
            candlesElapsed: 1
        };
    }

    // ── 7. PnL Accounting ────────────────────────────────────────────────────
    // roe = (exitPrice - entryPrice) / entryPrice  (signed, no leverage)
    // pnl = positionSizeUSDT × roe  (positionSizeUSDT is the notional value)
    const feeRate = 0.0004;
    const slippageRate = config.general?.maxSpreadPercent ?? 0.0005;
    const totalCosts = riskData.positionSizeUSDT * (feeRate + slippageRate) * 2;

    const grossProfit = riskData.positionSizeUSDT * tradeResult.roe;
    const netProfit   = grossProfit - totalCosts;
    const newBalance  = balance + netProfit;

    return {
        symbol,
        side:           signalData.signal,
        strategy:       signalData.strategy,
        regime,
        entryPrice:     slippageAdjustedEntry,
        exitPrice:      tradeResult.exitPrice,
        stopPrice:      signalData.stopLossPrice,
        takeProfitPrice: signalData.takeProfitPrice,
        roe:            (tradeResult.roe * 100).toFixed(4) + '%',
        pnl:            netProfit.toFixed(4),
        newBalance:     isFinite(newBalance) ? newBalance : 0,
        ts:             candle.ts,
        exitTime:       tradeResult.exitTime,
        candlesElapsed: tradeResult.candlesElapsed ?? 1,
        riskData,       // full audit object for logger
    };
}

/**
 * Walk future candles and check if SL or TP is hit first.
 *
 * Fallback behaviour: if neither SL nor TP is hit within the provided candle window
 * the trade is closed at the stop-loss price (worst-case exit), guaranteeing that
 * the fallback loss is ALWAYS bounded by the stop distance, not by market drift.
 */
function validateAbsoluteTradeRealistically(futureCandles, side, entryPrice, tpPrice, slPrice) {
    for (let i = 0; i < futureCandles.length; i++) {
        const c = futureCandles[i];
        if (side === 'BUY') {
            if (c.low  <= slPrice) return { win: false, roe: (slPrice - entryPrice) / entryPrice, exitPrice: slPrice, exitTime: c.ts, candlesElapsed: i + 1 };
            if (c.high >= tpPrice) return { win: true,  roe: (tpPrice - entryPrice) / entryPrice, exitPrice: tpPrice, exitTime: c.ts, candlesElapsed: i + 1 };
        } else {
            if (c.high >= slPrice) return { win: false, roe: (entryPrice - slPrice) / entryPrice, exitPrice: slPrice, exitTime: c.ts, candlesElapsed: i + 1 };
            if (c.low  <= tpPrice) return { win: true,  roe: (entryPrice - tpPrice) / entryPrice, exitPrice: tpPrice, exitTime: c.ts, candlesElapsed: i + 1 };
        }
    }

    // ── Fallback: window exhausted without hitting SL or TP ─────────────────
    // Exit at the stop-loss price to ensure loss is always bounded.
    // This is conservative (pessimistic) but ensures no unbounded losses in backtest.
    const lastCandle = futureCandles[futureCandles.length - 1];
    const exitTime   = lastCandle ? lastCandle.ts : Date.now();
    const exitPrice  = slPrice;
    const roe        = side === 'BUY'
        ? (slPrice - entryPrice) / entryPrice   // negative → loss
        : (entryPrice - slPrice) / entryPrice;  // negative → loss

    return {
        win: false,
        roe,
        exitPrice,
        exitTime,
        candlesElapsed: futureCandles.length,
    };
}
