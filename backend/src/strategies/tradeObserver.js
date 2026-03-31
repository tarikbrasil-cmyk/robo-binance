import { fetchRecentKlines } from '../data/marketData.js';
import { executeTradeSequence } from '../execution/orderRouter.js';
import { recordDecision } from '../audit/decisionJournal.js';
import { riskManager } from '../risk/riskManager.js';
import { activeTrades, monitorActiveTrade } from '../execution/tradeMonitor.js';
import { calculateIndicators, loadStrategyConfig } from '../strategy/regime_engine.js';
import { buildModularParamsFromConfig, evaluateModularStrategyV6 } from '../strategy/ModularStrategyV6.js';

const MIN_KLINES = 250; 

export async function processMarketTick(symbol, currentPrice, wss) {
    if (!riskManager.canOpenNewPosition()) return;
    
    // If position is active, monitor it, don't open new
    if (activeTrades[symbol]) {
        await monitorActiveTrade(symbol, currentPrice, wss);
        return; 
    }

    try {
        const config = loadStrategyConfig();
        const executionTimeframe = config.trendStrategy?.timeframe || '5m';
        const params = buildModularParamsFromConfig(config);
        
        const klines = await fetchRecentKlines(symbol, executionTimeframe, MIN_KLINES);
        
        if (!klines || klines.length < MIN_KLINES) {
            return;
        }

        const candles = klines.map((kline) => ({
            ts: kline[0],
            open: parseFloat(kline[1]),
            high: parseFloat(kline[2]),
            low: parseFloat(kline[3]),
            close: parseFloat(kline[4]),
            volume: parseFloat(kline[5]),
        }));
        const indicators = calculateIndicators(candles, config);
        const signalIndex = candles.length - 2;
        const indicator = indicators[signalIndex];

        if (!indicator?.atr) return;

        const baseSignal = evaluateModularStrategyV6(candles, indicators, signalIndex, params, symbol);
        let signal = null;

        if (baseSignal) {
            const atrDistance = indicator.atr * params.atrMultiplier;
            const tpDistance = indicator.atr * params.tpMultiplier;
            signal = {
                ...baseSignal,
                entryPrice: currentPrice,
                stopLossPrice: baseSignal.signal === 'BUY' ? currentPrice - atrDistance : currentPrice + atrDistance,
                takeProfitPrice: baseSignal.signal === 'BUY' ? currentPrice + tpDistance : currentPrice - tpDistance,
                indicator,
            };

            console.log(
                `[${signal.strategy}] ${signal.signal} signal for ${symbol} @ ${executionTimeframe} | ` +
                `EMA ${indicator.emaFast?.toFixed(2)}/${indicator.emaSlow?.toFixed(2)} | RSI ${indicator.rsi?.toFixed(1)}`
            );
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
                reason: `${signal.strategy} conditions aligned on the last closed candle`,
                context: {
                    timeframe: executionTimeframe,
                    emaFast: indicator.emaFast,
                    emaSlow: indicator.emaSlow,
                    emaHTF: indicator.emaHTF,
                    rsi: indicator.rsi,
                    atr: indicator.atr,
                    adx: indicator.adx,
                    useBreakout: params.useBreakout,
                    useMeanReversion: params.useMeanReversion,
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
