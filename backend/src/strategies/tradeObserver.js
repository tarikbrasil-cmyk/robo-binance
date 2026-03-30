import { fetchRecentKlines } from '../data/marketData.js';
import { executeTradeSequence } from '../execution/orderRouter.js';
import { recordDecision } from '../audit/decisionJournal.js';
import { riskManager } from '../risk/riskManager.js';
import { activeTrades, monitorActiveTrade } from '../execution/tradeMonitor.js';
import { EMA, RSI, ATR, ADX } from 'technicalindicators';

import { loadStrategyConfig } from '../strategy/regime_engine.js';

const MIN_KLINES = 250; 

// Removed hardcoded constraints for Strategy #1

export async function processMarketTick(symbol, currentPrice, wss) {
    if (!riskManager.canOpenNewPosition()) return;
    
    // If position is active, monitor it, don't open new
    if (activeTrades[symbol]) {
        await monitorActiveTrade(symbol, currentPrice, wss);
        return; 
    }

    try {
        const config = loadStrategyConfig();
        const { emaFast, emaSlow, rsiOversold, rsiOverbought, atrMultiplierSL, atrMultiplierTP, session, useSessionFilter } = config.trendStrategy;
        
        // 1. SESSION FILTER
        if (useSessionFilter) {
            const hour = new Date().getUTCHours();
            const allowed = {
                'ASIA': hour >= 0 && hour < 8,
                'LONDON': hour >= 8 && hour < 16,
                'NY': hour >= 13 && hour < 21
            };
            if (!allowed[session]) return;
        }

        const klines = await fetchRecentKlines(symbol, '5m', 250);
        
        if (!klines || klines.length < MIN_KLINES) {
            return;
        }

        const closes = klines.map(k => parseFloat(k[4]));
        const highs = klines.map(k => parseFloat(k[2]));
        const lows = klines.map(k => parseFloat(k[3]));
        // const volumes = klines.map(k => parseFloat(k[5]));

        const emaF = EMA.calculate({ period: emaFast, values: closes });
        const emaS = EMA.calculate({ period: emaSlow, values: closes });
        const rsiArray = RSI.calculate({ period: 14, values: closes });
        const atrArray = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
        const adxArray = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });

        const currentEmaF = emaF[emaF.length - 1];
        const currentEmaS = emaS[emaS.length - 1];
        const currentRsi = rsiArray[rsiArray.length - 1];
        const currentAtr = atrArray[atrArray.length - 1];
        const currentAdx = adxArray[adxArray.length - 1]?.adx;

        if (!currentEmaF || !currentEmaS || !currentRsi || !currentAtr) return;

        const isTrendUp = currentEmaF > currentEmaS;
        const isTrendDown = currentEmaF < currentEmaS;

        let signal = null;

        if (isTrendUp && currentRsi <= rsiOversold) {
            const sl = currentPrice - (currentAtr * atrMultiplierSL);
            const tp = currentPrice + (currentAtr * atrMultiplierTP);

            signal = {
                signal: 'BUY',
                strategy: 'STRATEGY_#1_PB',
                stopLossPrice: sl,
                takeProfitPrice: tp,
                indicator: { emaFast: currentEmaF, emaSlow: currentEmaS, rsi: currentRsi, atr: currentAtr, adx: currentAdx }
            };
            console.log(`[STRATEGY#1] BUY signal for ${symbol} | EMA ${emaFast}/${emaSlow} alignment | RSI ${currentRsi.toFixed(1)}`);
        } else if (isTrendDown && currentRsi >= rsiOverbought) {
            const sl = currentPrice + (currentAtr * atrMultiplierSL);
            const tp = currentPrice - (currentAtr * atrMultiplierTP);

            signal = {
                signal: 'SELL',
                strategy: 'STRATEGY_#1_PB',
                stopLossPrice: sl,
                takeProfitPrice: tp,
                indicator: { emaFast: currentEmaF, emaSlow: currentEmaS, rsi: currentRsi, atr: currentAtr, adx: currentAdx }
            };
            console.log(`[STRATEGY#1] SELL signal for ${symbol} | EMA ${emaFast}/${emaSlow} alignment | RSI ${currentRsi.toFixed(1)}`);
        }

        // ── Execute if signal found ──
        if (signal) {
            await recordDecision({
                source: 'TREND_OBSERVER',
                eventType: 'SIGNAL_DETECTED',
                decision: 'DETECTED',
                symbol,
                side: signal.signal,
                strategy: signal.strategy,
                price: currentPrice,
                reason: 'Trend and RSI pullback conditions aligned',
                context: {
                    emaFast: currentEmaF,
                    emaSlow: currentEmaS,
                    rsi: currentRsi,
                    atr: currentAtr,
                    adx: currentAdx,
                },
            }, { wss });

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
