import { fetchRecentKlines } from '../data/marketData.js';
import { executeTradeSequence } from '../execution/orderRouter.js';
import { riskManager } from '../risk/riskManager.js';
import { activeTrades, monitorActiveTrade } from '../execution/tradeMonitor.js';
import { EMA, RSI, ATR, ADX } from 'technicalindicators';

/**
 * STABILIZATION: Trade Observer — Single Trend Following Strategy
 * 
 * Strategy: EMA 50/200 + ADX > 25 + RSI pullback + Volume confirmation
 * 
 * BUY:  EMA50 > EMA200 + ADX > 25 + RSI < 40 (pullback) + Volume > avg
 * SELL: EMA50 < EMA200 + ADX > 25 + RSI > 60 (overbought) + Volume > avg
 * 
 * Stop: ATR × 1.5
 * TP:   ATR × 2.5
 */

const ATR_STOP_MULTIPLIER = 1.5;
const ATR_TP_MULTIPLIER = 2.5;
const ADX_THRESHOLD = 25;
const RSI_OVERSOLD = 40;   // Pullback entry for longs
const RSI_OVERBOUGHT = 60; // Pullback entry for shorts
const VOLUME_MULTIPLIER = 1.0; // Volume must be >= average
const MIN_KLINES = 210; // Need 200+ for EMA 200

export async function processMarketTick(symbol, currentPrice, wss) {
    if (!riskManager.canOpenNewPosition()) return;
    
    // If position is active, monitor it, don't open new
    if (activeTrades[symbol]) {
        await monitorActiveTrade(symbol, currentPrice, wss);
        return; 
    }

    try {
        const klines = await fetchRecentKlines(symbol, '5m', 250);
        
        if (!klines || klines.length < MIN_KLINES) {
            return;
        }

        // Extract OHLCV data
        const closes = klines.map(k => parseFloat(k[4]));
        const highs = klines.map(k => parseFloat(k[2]));
        const lows = klines.map(k => parseFloat(k[3]));
        const volumes = klines.map(k => parseFloat(k[5]));

        // ── Calculate Indicators ──
        const ema50 = EMA.calculate({ period: 50, values: closes });
        const ema200 = EMA.calculate({ period: 200, values: closes });
        const rsi14 = RSI.calculate({ period: 14, values: closes });
        const atr14 = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
        const adx14 = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });

        // Get latest values (aligned to the most recent candle)
        const currentEma50 = ema50[ema50.length - 1];
        const currentEma200 = ema200[ema200.length - 1];
        const currentRsi = rsi14[rsi14.length - 1];
        const currentAtr = atr14[atr14.length - 1];
        const currentAdx = adx14[adx14.length - 1]?.adx;

        // Volume check: current vs 20-period average
        const recentVolumes = volumes.slice(-20);
        const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
        const currentVolume = volumes[volumes.length - 1];
        const volumeRatio = currentVolume / avgVolume;

        // ── Validate all indicators are defined ──
        if (!currentEma50 || !currentEma200 || !currentRsi || !currentAtr || !currentAdx) {
            return; // Silently skip — not enough data yet
        }

        // ── Strategy: Trend Following ──
        const isUptrend = currentEma50 > currentEma200;
        const isDowntrend = currentEma50 < currentEma200;
        const isStrongTrend = currentAdx > ADX_THRESHOLD;
        const isVolumeConfirmed = volumeRatio >= VOLUME_MULTIPLIER;

        let signal = null;

        // BUY: Uptrend + Strong ADX + RSI pullback + Volume
        if (isUptrend && isStrongTrend && currentRsi < RSI_OVERSOLD && isVolumeConfirmed) {
            const stopLossPrice = currentPrice - (currentAtr * ATR_STOP_MULTIPLIER);
            const takeProfitPrice = currentPrice + (currentAtr * ATR_TP_MULTIPLIER);

            signal = {
                signal: 'BUY',
                strategy: 'TREND_FOLLOWING',
                stopLossPrice,
                takeProfitPrice,
                stopATRMultiplier: ATR_STOP_MULTIPLIER,
                indicator: {
                    ema50: currentEma50,
                    ema200: currentEma200,
                    rsi: currentRsi,
                    atr: currentAtr,
                    adx: currentAdx,
                    volume: currentVolume,
                    volSma20: avgVolume,
                }
            };

            console.log(`[STRATEGY] BUY signal for ${symbol} | EMA50=${currentEma50.toFixed(2)} > EMA200=${currentEma200.toFixed(2)} | ADX=${currentAdx.toFixed(1)} | RSI=${currentRsi.toFixed(1)} | Vol=${volumeRatio.toFixed(2)}x`);
        }

        // SELL: Downtrend + Strong ADX + RSI overbought + Volume
        if (!signal && isDowntrend && isStrongTrend && currentRsi > RSI_OVERBOUGHT && isVolumeConfirmed) {
            const stopLossPrice = currentPrice + (currentAtr * ATR_STOP_MULTIPLIER);
            const takeProfitPrice = currentPrice - (currentAtr * ATR_TP_MULTIPLIER);

            signal = {
                signal: 'SELL',
                strategy: 'TREND_FOLLOWING',
                stopLossPrice,
                takeProfitPrice,
                stopATRMultiplier: ATR_STOP_MULTIPLIER,
                indicator: {
                    ema50: currentEma50,
                    ema200: currentEma200,
                    rsi: currentRsi,
                    atr: currentAtr,
                    adx: currentAdx,
                    volume: currentVolume,
                    volSma20: avgVolume,
                }
            };

            console.log(`[STRATEGY] SELL signal for ${symbol} | EMA50=${currentEma50.toFixed(2)} < EMA200=${currentEma200.toFixed(2)} | ADX=${currentAdx.toFixed(1)} | RSI=${currentRsi.toFixed(1)} | Vol=${volumeRatio.toFixed(2)}x`);
        }

        // ── Execute if signal found ──
        if (signal) {
            const pos = await executeTradeSequence(symbol, signal.signal, currentPrice, wss, signal);
            
            if (pos) {
                activeTrades[symbol] = {
                    symbol,
                    side: pos.side,
                    entryPrice: pos.entryPrice,
                    quantity: pos.quantity,
                    highestPrice: currentPrice, 
                    slTarget: pos.slTarget,
                    tsActive: false
                };
            }
        }
    } catch (e) {
        console.error(`[STRATEGY] Error processing ${symbol}: ${e.message}`);
    }
}
