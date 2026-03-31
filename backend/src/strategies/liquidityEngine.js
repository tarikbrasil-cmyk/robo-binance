import { riskManager } from '../risk/riskManager.js';
import { executeTradeSequence } from '../execution/orderRouter.js';
import { recordDecision } from '../audit/decisionJournal.js';
import { isSymbolAllowed } from '../data/marketScanner.js';
import { fetchRecentKlines } from '../data/marketData.js';
import { EMA } from 'technicalindicators';

/**
 * STABILIZATION: Liquidity Engine with Filters
 * 
 * Before executing any reversal trade, requires:
 * 1. Symbol in whitelist (BTC/ETH/SOL)
 * 2. Candle confirmation (last closed candle confirms reversal direction)
 * 3. Volume above 20-period average
 * 4. Trend alignment (EMA 50/200)
 */

const liquidationCache = {}; 
const SPIKE_THRESHOLD_USDT = 500000;

export async function analyzeLiquidationSpike(symbol, liquidatedSide, volumeUsdt, wss) {
    // ── Filter 1: Symbol whitelist ──
    if (!isSymbolAllowed(symbol)) {
        return;
    }

    if (!riskManager.canOpenNewPosition()) return;

    if (!liquidationCache[symbol]) {
        liquidationCache[symbol] = { longLiq: 0, shortLiq: 0, lastCheck: Date.now() };
    }

    // Reset every 5 min
    if (Date.now() - liquidationCache[symbol].lastCheck > 60000 * 5) {
        liquidationCache[symbol] = { longLiq: 0, shortLiq: 0, lastCheck: Date.now() };
    }

    if (liquidatedSide === 'SELL') {
        liquidationCache[symbol].longLiq += volumeUsdt;
    } else {
        liquidationCache[symbol].shortLiq += volumeUsdt;
    }

    // Short Squeeze → possible reversal SHORT
    if (liquidationCache[symbol].shortLiq >= SPIKE_THRESHOLD_USDT) {
        console.log(`[LIQUIDITY] Short squeeze detected on ${symbol} (>$${(liquidationCache[symbol].shortLiq/1000).toFixed(0)}k)`);
        await recordDecision({
            source: 'LIQUIDITY_ENGINE',
            eventType: 'LIQUIDATION_SPIKE',
            decision: 'DETECTED',
            symbol,
            side: 'SELL',
            strategy: 'LIQUIDITY_REVERSAL',
            reason: `Short squeeze above ${SPIKE_THRESHOLD_USDT} USDT`,
            context: { liquidationNotional: liquidationCache[symbol].shortLiq },
        }, { wss });
        liquidationCache[symbol].shortLiq = 0; 
        await attemptFilteredReversalTrade(symbol, 'SELL', wss);
    }
    
    // Long Cascade → possible reversal LONG
    else if (liquidationCache[symbol].longLiq >= SPIKE_THRESHOLD_USDT) {
        console.log(`[LIQUIDITY] Long cascade detected on ${symbol} (>$${(liquidationCache[symbol].longLiq/1000).toFixed(0)}k)`);
        await recordDecision({
            source: 'LIQUIDITY_ENGINE',
            eventType: 'LIQUIDATION_SPIKE',
            decision: 'DETECTED',
            symbol,
            side: 'BUY',
            strategy: 'LIQUIDITY_REVERSAL',
            reason: `Long cascade above ${SPIKE_THRESHOLD_USDT} USDT`,
            context: { liquidationNotional: liquidationCache[symbol].longLiq },
        }, { wss });
        liquidationCache[symbol].longLiq = 0; 
        await attemptFilteredReversalTrade(symbol, 'BUY', wss);
    }
}

async function attemptFilteredReversalTrade(symbol, side, wss) {
    try {
        // ── Filter 2: Fetch klines for candle and volume confirmation ──
        const klines = await fetchRecentKlines(symbol, '5m', 210);
        if (!klines || klines.length < 210) {
            console.log(`[LIQUIDITY] Trade ignored: insufficient kline data for ${symbol}`);
            await recordDecision({
                source: 'LIQUIDITY_ENGINE',
                eventType: 'LIQUIDITY_FILTER_REJECTED',
                decision: 'BLOCKED',
                symbol,
                side,
                strategy: 'LIQUIDITY_REVERSAL',
                reason: 'Insufficient kline data for reversal validation',
            }, { wss });
            return;
        }

        const closes = klines.map(k => parseFloat(k[4]));
        const volumes = klines.map(k => parseFloat(k[5]));
        const lastCandle = klines[klines.length - 2]; // Last CLOSED candle
        const candleOpen = parseFloat(lastCandle[1]);
        const candleClose = parseFloat(lastCandle[4]);

        // ── Filter 3: Candle confirmation ──
        const isBullishCandle = candleClose > candleOpen;
        const isBearishCandle = candleClose < candleOpen;

        if (side === 'BUY' && !isBullishCandle) {
            console.log(`[LIQUIDITY] Trade ignored for ${symbol}: BUY signal but last candle is bearish`);
            await recordDecision({
                source: 'LIQUIDITY_ENGINE',
                eventType: 'LIQUIDITY_FILTER_REJECTED',
                decision: 'BLOCKED',
                symbol,
                side,
                strategy: 'LIQUIDITY_REVERSAL',
                reason: 'Last closed candle did not confirm bullish reversal',
            }, { wss });
            return;
        }
        if (side === 'SELL' && !isBearishCandle) {
            console.log(`[LIQUIDITY] Trade ignored for ${symbol}: SELL signal but last candle is bullish`);
            await recordDecision({
                source: 'LIQUIDITY_ENGINE',
                eventType: 'LIQUIDITY_FILTER_REJECTED',
                decision: 'BLOCKED',
                symbol,
                side,
                strategy: 'LIQUIDITY_REVERSAL',
                reason: 'Last closed candle did not confirm bearish reversal',
            }, { wss });
            return;
        }

        // ── Filter 4: Volume above 20-period average ──
        const recentVolumes = volumes.slice(-21, -1); // Last 20 closed candles
        const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
        const currentVolume = volumes[volumes.length - 1];

        if (currentVolume < avgVolume) {
            console.log(`[LIQUIDITY] Trade ignored for ${symbol}: volume ${currentVolume.toFixed(0)} < avg ${avgVolume.toFixed(0)}`);
            await recordDecision({
                source: 'LIQUIDITY_ENGINE',
                eventType: 'LIQUIDITY_FILTER_REJECTED',
                decision: 'BLOCKED',
                symbol,
                side,
                strategy: 'LIQUIDITY_REVERSAL',
                reason: 'Current volume below 20-candle average',
                context: { currentVolume, avgVolume },
            }, { wss });
            return;
        }

        // ── Filter 5: Trend alignment (EMA 50/200) ──
        const ema50 = EMA.calculate({ period: 50, values: closes });
        const ema200 = EMA.calculate({ period: 200, values: closes });
        const currentEma50 = ema50[ema50.length - 1];
        const currentEma200 = ema200[ema200.length - 1];

        if (side === 'BUY' && currentEma50 < currentEma200) {
            console.log(`[LIQUIDITY] Trade ignored for ${symbol}: BUY but EMA50 < EMA200 (downtrend)`);
            await recordDecision({
                source: 'LIQUIDITY_ENGINE',
                eventType: 'LIQUIDITY_FILTER_REJECTED',
                decision: 'BLOCKED',
                symbol,
                side,
                strategy: 'LIQUIDITY_REVERSAL',
                reason: 'Trend filter blocked BUY because EMA50 < EMA200',
                context: { ema50: currentEma50, ema200: currentEma200 },
            }, { wss });
            return;
        }
        if (side === 'SELL' && currentEma50 > currentEma200) {
            console.log(`[LIQUIDITY] Trade ignored for ${symbol}: SELL but EMA50 > EMA200 (uptrend)`);
            await recordDecision({
                source: 'LIQUIDITY_ENGINE',
                eventType: 'LIQUIDITY_FILTER_REJECTED',
                decision: 'BLOCKED',
                symbol,
                side,
                strategy: 'LIQUIDITY_REVERSAL',
                reason: 'Trend filter blocked SELL because EMA50 > EMA200',
                context: { ema50: currentEma50, ema200: currentEma200 },
            }, { wss });
            return;
        }

        // ── All filters passed — execute ──
        const currentPrice = closes[closes.length - 1];
        console.log(`[LIQUIDITY] All filters passed for ${symbol} ${side} @ ~${currentPrice}. Executing.`);
        await recordDecision({
            source: 'LIQUIDITY_ENGINE',
            eventType: 'SIGNAL_DETECTED',
            decision: 'DETECTED',
            symbol,
            side,
            strategy: 'LIQUIDITY_REVERSAL',
            price: currentPrice,
            reason: 'Liquidation reversal passed candle, volume, and trend filters',
        }, { wss });
        
        // Note: executeTradeSequence will do its own validation (ADX, ATR, etc.)
        // For liquidity trades we still need to provide indicator data
        const { ATR: ATRCalc, ADX: ADXCalc } = await import('technicalindicators');
        const highs = klines.map(k => parseFloat(k[2]));
        const lows = klines.map(k => parseFloat(k[3]));
        const atr14 = ATRCalc.calculate({ high: highs, low: lows, close: closes, period: 14 });
        const adx14 = ADXCalc.calculate({ high: highs, low: lows, close: closes, period: 14 });
        const currentAtr = atr14[atr14.length - 1];
        const currentAdx = adx14[adx14.length - 1]?.adx;

        const stopLossPrice = side === 'BUY' 
            ? currentPrice - (currentAtr * 1.5)
            : currentPrice + (currentAtr * 1.5);
        const takeProfitPrice = side === 'BUY'
            ? currentPrice + (currentAtr * 2.5)
            : currentPrice - (currentAtr * 2.5);

        await executeTradeSequence(symbol, side, currentPrice, wss, {
            strategy: 'LIQUIDITY_REVERSAL',
            stopLossPrice,
            takeProfitPrice,
            stopATRMultiplier: 1.5,
            indicator: {
                atr: currentAtr,
                adx: currentAdx,
                ema50: currentEma50,
                ema200: currentEma200,
                volume: currentVolume,
                volSma20: avgVolume,
            }
        });
        
    } catch(e) {
        console.error(`[LIQUIDITY] Error processing reversal for ${symbol}: ${e.message}`);
        await recordDecision({
            source: 'LIQUIDITY_ENGINE',
            eventType: 'LIQUIDITY_ENGINE_ERROR',
            decision: 'FAILED',
            symbol,
            side,
            strategy: 'LIQUIDITY_REVERSAL',
            reason: e.message,
        }, { wss });
    }
}
