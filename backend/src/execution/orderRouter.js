import exchange, { IS_SPOT, BOT_MODE } from '../services/exchangeClient.js';
import { insertLog, insertPnL } from '../database/db.js';
import { broadcastMessage } from '../utils/websocket.js';
import { calculatePositionSize } from '../risk/position_sizing.js';
import { activeTrades } from './tradeMonitor.js';
import { isSymbolAllowed } from '../data/marketScanner.js';

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
        const balanceInfo = await exchange.fetchBalance();
        const availableBalance = IS_SPOT
            ? (balanceInfo.free?.USDT || 0)
            : (balanceInfo.total?.USDT || 0);

        const atr = strategyData.indicator.atr;
        const stopATRMultiplier = strategyData.stopATRMultiplier || 1.5;

        const positionalData = calculatePositionSize({
            accountBalance: availableBalance,
            entryPrice: currentPrice,
            atr,
            stopATRMultiplier,
            maxRiskPerTrade: 0.005,
        });

        if (positionalData.positionSizeUSDT <= 0) {
            insertLog('SIZING_REJECTED', `[${symbol}] ${positionalData.reason}`);
            return null;
        }

        const positionalUSDT = positionalData.positionSizeUSDT;

        const stopLossPrice = strategyData.stopLossPrice;
        const takeProfitPrice = strategyData.takeProfitPrice;

        const leverage = IS_SPOT ? 1 : 5;

        await exchange.loadMarkets();

        let quantity;

        if (IS_SPOT) {
            const rawQuantity = (positionalUSDT * 0.98) / currentPrice;
            quantity = parseFloat(exchange.amountToPrecision(symbol, rawQuantity));
        } else {
            await exchange.setLeverage(leverage, symbol);
            try { await exchange.setMarginMode('ISOLATED', symbol); } catch {}

            const notional = positionalUSDT * 0.98;
            const rawQuantity = notional / currentPrice;
            quantity = parseFloat(exchange.amountToPrecision(symbol, rawQuantity));
        }

        const market = exchange.market(symbol);
        const minQty = market.limits?.amount?.min || 0;
        const maxQty = market.limits?.amount?.max || Infinity;
        const minNotional = market.limits?.cost?.min || 0;

        if (quantity < minQty || quantity > maxQty || quantity * currentPrice < minNotional) {
            insertLog('ORDER_REJECTED', `[${symbol}] invalid quantity`);
            return null;
        }

        const entryOrder = await exchange.createMarketOrder(symbol, side, quantity);
        executionFailures = 0;

        const entryPrice = entryOrder.average || currentPrice;

        // 🔥 VALIDAÇÃO CRÍTICA (ANTI-BUG)
        if (side === 'BUY') {
            if (takeProfitPrice <= entryPrice) throw new Error(`TP inválido BUY`);
            if (stopLossPrice >= entryPrice) throw new Error(`SL inválido BUY`);
        } else {
            if (takeProfitPrice >= entryPrice) throw new Error(`TP inválido SELL`);
            if (stopLossPrice <= entryPrice) throw new Error(`SL inválido SELL`);
        }

        const exitSide = IS_SPOT ? 'SELL' : (side === 'BUY' ? 'SELL' : 'BUY');

        // ✅ CORREÇÃO DEFINITIVA — SEM REESCALA
        const tpPriceF = parseFloat(exchange.priceToPrecision(symbol, takeProfitPrice));
        const slPriceF = parseFloat(exchange.priceToPrecision(symbol, stopLossPrice));

        console.log(`[TRADE] ${symbol} ${side}`);
        console.log(`Entry: ${entryPrice}`);
        console.log(`TP: ${tpPriceF}`);
        console.log(`SL: ${slPriceF}`);

        if (IS_SPOT) {
            try {
                const slLimitPrice = parseFloat(exchange.priceToPrecision(symbol, slPriceF * 0.995));

                await exchange.privatePostOrderOco({
                    symbol: symbol.replace('/', '').split(':')[0],
                    side: exitSide,
                    quantity,
                    price: tpPriceF,
                    stopPrice: slPriceF,
                    stopLimitPrice: slLimitPrice,
                    stopLimitTimeInForce: 'GTC'
                });

            } catch {
                await exchange.createOrder(symbol, 'stop_loss_limit', exitSide, quantity, slPriceF, {
                    stopPrice: slPriceF
                });
            }

        } else {
            await exchange.createOrder(symbol, 'TAKE_PROFIT_MARKET', exitSide, quantity, tpPriceF, {
                stopPrice: tpPriceF,
                reduceOnly: true
            });

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
            tpTarget: tpPriceF,
            slTarget: slPriceF,
            leverage,
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
