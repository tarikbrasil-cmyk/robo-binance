import exchange, { IS_SPOT, BOT_MODE } from '../services/exchangeClient.js';
import { insertLog } from '../database/db.js';
import { broadcastMessage } from '../utils/websocket.js';
import { calculatePositionSize } from '../risk/position_sizing.js';
import { activeTrades } from './tradeMonitor.js';
import { isSymbolAllowed } from '../data/marketScanner.js';
import { loadStrategyConfig } from '../strategy/regime_engine.js';

let executionFailures = 0;
let circuitBreakerUntil = 0;

// ── Pre-trade validation ──
function validateTradeData(symbol, side, currentPrice, strategyData) {
    const errors = [];

    if (!currentPrice || currentPrice <= 0) errors.push(`price=${currentPrice}`);
    if (!strategyData?.indicator?.adx && strategyData?.indicator?.adx !== 0) errors.push(`adx=undefined`);
    if (!strategyData?.indicator?.atr || strategyData.indicator.atr <= 0) errors.push(`atr=${strategyData?.indicator?.atr}`);
    if (!strategyData?.stopLossPrice || strategyData.stopLossPrice <= 0) errors.push(`stopLoss=${strategyData?.stopLossPrice}`);
    if (!strategyData?.takeProfitPrice || strategyData.takeProfitPrice <= 0) errors.push(`takeProfit=${strategyData?.takeProfitPrice}`);
    if (!side || (side !== 'BUY' && side !== 'SELL')) errors.push(`side=${side}`);
    if (!isSymbolAllowed(symbol)) errors.push(`symbol=${symbol} not in whitelist`);

    if (errors.length > 0) {
        const reason = errors.join(', ');
        console.error(`[VALIDATION] Trade rejected for ${symbol} ${side}: ${reason}`);
        insertLog('VALIDATION_REJECTED', `[${symbol}] ${side} rejected: ${reason}`);
        return false;
    }

    return true;
}

export async function executeTradeSequence(symbol, side, currentPrice, wss, strategyData = {}) {

    if (Date.now() < circuitBreakerUntil) {
        const remainingSec = Math.ceil((circuitBreakerUntil - Date.now()) / 1000);
        console.warn(`[FAIL-SAFE] Circuit Breaker active (${remainingSec}s)`);
        return null;
    }

    if (!validateTradeData(symbol, side, currentPrice, strategyData)) return null;

    if (activeTrades[symbol]) {
        console.log(`[EXECUTION] Active position exists for ${symbol}`);
        return null;
    }

    if (IS_SPOT && side === 'SELL') {
        console.log(`[EXECUTION] SPOT ignores SELL`);
        return null;
    }

    try {
        // ── Funding Rate Filter ──
        const fundingInfo = await exchange.fetchFundingRate(symbol);
        const fundingThreshold = config.risk?.maxFundingRate || 0.05; // 0.05%
        if (Math.abs(fundingInfo.fundingRate) > fundingThreshold) {
             insertLog('FUNDING_REJECTED', `[${symbol}] rate=${fundingInfo.fundingRate}`);
             return null;
        }

        const positionalData = calculatePositionSize({
            accountBalance: availableBalance,
            entryPrice: currentPrice,
            atr: strategyData.indicator.atr,
            stopATRMultiplier: strategyData.strategy === 'TREND_V2' ? 1.5 : 1.0,
            maxRiskPerTrade: config.risk?.maxRiskPerTrade || 0.005,
            currentExposureUSDT,
            maxExposureLimit: config.risk?.maxAccountExposure || 0.10,
            maxDrawdownLimit: config.general?.maxDrawdownStop || 0.10
        });

        if (positionalData.positionSizeUSDT <= 0) {
            insertLog('SIZING_REJECTED', `[${symbol}] ${positionalData.reason}`);
            return null;
        }

        const positionalUSDT = positionalData.positionSizeUSDT;
        const stopLossPrice = strategyData.stopLossPrice;
        const takeProfitPrice = strategyData.takeProfitPrice;
        const tp1Price = strategyData.tp1Price;

        const leverage = IS_SPOT ? 1 : (config?.trendStrategy?.leverage || 5);
        await exchange.loadMarkets();

        let quantity;
        if (IS_SPOT) {
            const rawQuantity = (positionalUSDT * 0.98) / currentPrice;
            quantity = parseFloat(exchange.amountToPrecision(symbol, rawQuantity));
        } else {
            await exchange.setLeverage(leverage, symbol);
            try { await exchange.setMarginMode('ISOLATED', symbol); } catch {}
            const rawQuantity = (positionalUSDT * 0.98) / currentPrice;
            quantity = parseFloat(exchange.amountToPrecision(symbol, rawQuantity));
        }

        const market = exchange.market(symbol);
        const entryOrder = await exchange.createMarketOrder(symbol, side, quantity);
        const entryPrice = entryOrder.average || currentPrice;
        const exitSide = side === 'BUY' ? 'SELL' : 'BUY';

        const slPriceF = parseFloat(exchange.priceToPrecision(symbol, stopLossPrice));
        const tpFinalF = parseFloat(exchange.priceToPrecision(symbol, takeProfitPrice));
        const tp1PriceF = tp1Price ? parseFloat(exchange.priceToPrecision(symbol, tp1Price)) : null;

        console.log(`\n[PRO V2] Executing ${strategyData.strategy} | Final TP: ${tpFinalF} | SL: ${slPriceF}`);

        if (!IS_SPOT) {
            // If TP1 exists (Trend Strategy), split the exit
            if (tp1PriceF) {
                const qty1 = parseFloat(exchange.amountToPrecision(symbol, quantity * 0.5));
                const qty2 = parseFloat(exchange.amountToPrecision(symbol, quantity - qty1));

                // TP1 (50%)
                await exchange.createOrder(symbol, 'TAKE_PROFIT_MARKET', exitSide, qty1, tp1PriceF, {
                    stopPrice: tp1PriceF,
                    reduceOnly: true
                });

                // Final TP (50%)
                await exchange.createOrder(symbol, 'TAKE_PROFIT_MARKET', exitSide, qty2, tpFinalF, {
                    stopPrice: tpFinalF,
                    reduceOnly: true
                });
            } else {
                // Regular TP for Range
                await exchange.createOrder(symbol, 'TAKE_PROFIT_MARKET', exitSide, quantity, tpFinalF, {
                    stopPrice: tpFinalF,
                    reduceOnly: true
                });
            }

            // Initial SL (100%)
            await exchange.createOrder(symbol, 'STOP_MARKET', exitSide, quantity, slPriceF, {
                stopPrice: slPriceF,
                reduceOnly: true
            });
        }

        const activePosition = {
            symbol,
            side,
            entryPrice,
            quantity,
            tpTarget: tpFinalF,
            tp1Target: tp1PriceF,
            slTarget: slPriceF,
            leverage,
            strategy: strategyData.strategy,
            timestamp: Date.now(),
            mode: BOT_MODE
        };

        if (wss) broadcastMessage(wss, 'POSITION_OPENED', activePosition);

        return activePosition;

    } catch (error) {
        executionFailures++;
        insertLog('CRITICAL_ERROR', error.message);

        if (executionFailures >= 3) {
            circuitBreakerUntil = Date.now() + 300000;
            executionFailures = 0;
        }

        return null;
    }
}
