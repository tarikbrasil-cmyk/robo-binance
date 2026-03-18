import exchange, { IS_SPOT, BOT_MODE } from '../services/exchangeClient.js';
import { insertLog, insertPnL } from '../database/db.js';
import { broadcastMessage } from '../utils/websocket.js';
import { calculatePositionSize } from '../risk/position_sizing.js';
import { activeTrades } from './tradeMonitor.js';
import { isSymbolAllowed } from '../data/marketScanner.js';

/**
 * STABILIZATION: Order Router v2
 * 
 * Changes from original:
 * - Pre-trade validation gate (ADX, ATR, SL, TP required)
 * - Simplified position sizing (no Kelly, no volatility scaling)
 * - Risk reduced to 0.5% per trade
 * - Circuit breaker pause increased to 5 minutes
 * - Structured logging for every decision
 * - Symbol whitelist enforcement
 */

let executionFailures = 0;
let circuitBreakerUntil = 0;

// ── STABILIZATION: Pre-trade validation ──
function validateTradeData(symbol, side, currentPrice, strategyData) {
    const errors = [];

    if (!currentPrice || currentPrice <= 0) {
        errors.push(`price=${currentPrice}`);
    }

    if (!strategyData?.indicator?.adx && strategyData?.indicator?.adx !== 0) {
        errors.push(`adx=undefined`);
    }

    if (!strategyData?.indicator?.atr || strategyData.indicator.atr <= 0) {
        errors.push(`atr=${strategyData?.indicator?.atr}`);
    }

    if (!strategyData?.stopLossPrice || strategyData.stopLossPrice <= 0) {
        errors.push(`stopLoss=${strategyData?.stopLossPrice}`);
    }

    if (!strategyData?.takeProfitPrice || strategyData.takeProfitPrice <= 0) {
        errors.push(`takeProfit=${strategyData?.takeProfitPrice}`);
    }

    if (!side || (side !== 'BUY' && side !== 'SELL')) {
        errors.push(`side=${side}`);
    }

    if (!isSymbolAllowed(symbol)) {
        errors.push(`symbol=${symbol} not in whitelist`);
    }

    if (errors.length > 0) {
        const reason = errors.join(', ');
        console.error(`[VALIDATION] Trade rejected for ${symbol} ${side}: ${reason}`);
        insertLog('VALIDATION_REJECTED', `[${symbol}] ${side} rejected: ${reason}`);
        return false;
    }

    return true;
}

export async function executeTradeSequence(symbol, side, currentPrice, wss, strategyData = {}) {
    // 0. Circuit Breaker check
    if (Date.now() < circuitBreakerUntil) {
        const remainingSec = Math.ceil((circuitBreakerUntil - Date.now()) / 1000);
        console.warn(`[FAIL-SAFE] Circuit Breaker active. Trading paused for ${remainingSec}s.`);
        return null;
    }

    // 1. Pre-trade validation
    if (!validateTradeData(symbol, side, currentPrice, strategyData)) {
        return null;
    }

    // 2. Position Locking
    if (activeTrades[symbol]) {
        console.log(`[EXECUTION] Active position blocks new entry for ${symbol}. Ignored.`);
        return null;
    }

    // Em SPOT, apenas BUY é permitido
    if (IS_SPOT && side === 'SELL') {
        console.log(`[EXECUTION] SPOT mode: SELL signal ignored (no short in Spot).`);
        return null;
    }

    try {
        const balanceInfo = await exchange.fetchBalance();
        const availableBalance = IS_SPOT
            ? (balanceInfo.free?.USDT || 0)
            : (balanceInfo.total?.USDT || 0);

        // ── STABILIZATION: Simplified position sizing ──
        const atr = strategyData.indicator.atr;
        const stopATRMultiplier = strategyData.stopATRMultiplier || 1.5;
        
        const positionalData = calculatePositionSize({
            accountBalance: availableBalance,
            entryPrice: currentPrice,
            atr: atr,
            stopATRMultiplier: stopATRMultiplier,
            maxRiskPerTrade: 0.005, // 0.5% hard override
        });

        if (positionalData.positionSizeUSDT <= 0) {
            console.log(`[POSITION_SIZE] Rejected for ${symbol}: ${positionalData.reason}`);
            insertLog('SIZING_REJECTED', `[${symbol}] ${positionalData.reason}`);
            return null;
        }

        console.log(`[POSITION_SIZE] ${symbol} | Balance: $${availableBalance.toFixed(2)} | Risk: ${(positionalData.finalRiskPct * 100).toFixed(2)}% | Size: $${positionalData.positionSizeUSDT.toFixed(2)} | Stop: ${(positionalData.stopDistancePercent * 100).toFixed(3)}%`);

        const positionalUSDT = positionalData.positionSizeUSDT;

        // Use strategy-provided SL/TP prices
        const stopLossPrice = strategyData.stopLossPrice;
        const takeProfitPrice = strategyData.takeProfitPrice;

        // Leverage (conservative)
        const leverage = IS_SPOT ? 1 : 5;

        await exchange.loadMarkets();

        let quantity;

        if (IS_SPOT) {
            const rawQuantity = (positionalUSDT * 0.98) / currentPrice;
            quantity = parseFloat(exchange.amountToPrecision(symbol, rawQuantity));
            console.log(`[EXECUTION] SPOT BUY ${quantity} ${symbol} @ ~${currentPrice}`);
        } else {
            await exchange.setLeverage(leverage, symbol);
            try {
                await exchange.setMarginMode('ISOLATED', symbol);
            } catch (mErr) { /* Already ISOLATED */ }

            const notional = positionalUSDT * 0.98;
            const rawQuantity = notional / currentPrice;
            quantity = parseFloat(exchange.amountToPrecision(symbol, rawQuantity));
            
            console.log(`[EXECUTION] FUTURES ${side} ${quantity} ${symbol} @ ~${currentPrice} | Notional: $${notional.toFixed(2)} | Lev: ${leverage}x`);
        }

        // ── Exchange Filters: minQty, maxQty, stepSize ──
        const market = exchange.market(symbol);
        const minQty = market.limits?.amount?.min || 0;
        const maxQty = market.limits?.amount?.max || Infinity;
        const minNotional = market.limits?.cost?.min || 0;

        if (quantity < minQty) {
            console.error(`[VALIDATION] Order REJECTED: qty ${quantity} < minQty ${minQty} for ${symbol}`);
            insertLog('ORDER_REJECTED', `[${symbol}] qty ${quantity} < min ${minQty}`);
            return null;
        }
        if (quantity > maxQty) {
            console.error(`[VALIDATION] Order REJECTED: qty ${quantity} > maxQty ${maxQty} for ${symbol}`);
            insertLog('ORDER_REJECTED', `[${symbol}] qty ${quantity} > max ${maxQty}`);
            return null;
        }
        if (quantity * currentPrice < minNotional) {
            console.error(`[VALIDATION] Order REJECTED: notional ${(quantity * currentPrice).toFixed(2)} < min ${minNotional} for ${symbol}`);
            insertLog('ORDER_REJECTED', `[${symbol}] notional below minimum`);
            return null;
        }

        // ── Execute entry order ──
        let entryOrder = await exchange.createMarketOrder(symbol, side, quantity);
        
        // Reset failures on success
        executionFailures = 0;
        let entryPrice = entryOrder.average || currentPrice;

        insertLog('TRADE_OPENED', `[${symbol}] ${side} executed at ${entryPrice} (Qty: ${quantity})`);

        const activePosition = {
            symbol,
            side,
            entryPrice,
            quantity,
            leverage: IS_SPOT ? 1 : leverage,
            timestamp: Date.now(),
            mode: BOT_MODE
        };

        // Exit side
        const exitSide = IS_SPOT ? 'SELL' : (side === 'BUY' ? 'SELL' : 'BUY');

        // Use strategy-provided TP/SL recalculated from actual entry

        const tpPriceF = parseFloat(exchange.priceToPrecision(symbol, takeProfitPrice));
        const slPriceF = parseFloat(exchange.priceToPrecision(symbol, stopLossPrice));

        // ── Structured trade info log ──
        const adx = strategyData.indicator?.adx;
        const atrVal = strategyData.indicator?.atr;
        const volume = strategyData.indicator?.volume;
        const volAvg = strategyData.indicator?.volSma20;

        console.log(`\n==================================================`);
        console.log(`          TRADE SIGNAL INFO (Stabilized)`);
        console.log(`==================================================`);
        console.log(`Symbol:          ${symbol}`);
        console.log(`Strategy:        ${strategyData.strategy || 'TREND_FOLLOWING'}`);
        console.log(`Side:            ${side}`);
        console.log(`ADX:             ${adx != null ? adx.toFixed(2) : 'N/A'}`);
        console.log(`ATR:             ${atrVal != null ? atrVal.toFixed(2) : 'N/A'}`);
        console.log(`Volume:          ${volume != null ? volume.toFixed(0) : 'N/A'}`);
        console.log(`Vol/Avg:         ${(volume && volAvg) ? (volume / volAvg).toFixed(2) + 'x' : 'N/A'}`);
        console.log(`--------------------------------------------------`);
        console.log(`Entry:           ${entryPrice.toFixed(2)}`);
        console.log(`Stop:            ${slPriceF.toFixed(2)}`);
        console.log(`TP:              ${tpPriceF.toFixed(2)}`);
        console.log(`Position:        $${positionalUSDT.toFixed(2)}`);
        console.log(`Risk:            ${(positionalData.finalRiskPct * 100).toFixed(2)}% ($${positionalData.riskAmountUSDT.toFixed(2)})`);
        console.log(`==================================================\n`);

        if (IS_SPOT) {
            // SPOT: OCO
            try {
                const slLimitPrice = parseFloat(exchange.priceToPrecision(symbol, slPriceF * 0.995));
                
                const ocoParams = {
                    symbol: symbol.replace('/', '').split(':')[0],
                    side: exitSide,
                    quantity: quantity,
                    price: tpPriceF,
                    stopPrice: slPriceF,
                    stopLimitPrice: slLimitPrice,
                    stopLimitTimeInForce: 'GTC'
                };

                console.log(`[EXECUTION] SPOT OCO: TP=${tpPriceF}, SL=${slPriceF}`);
                await exchange.privatePostOrderOco(ocoParams);
                
                insertLog('STRATEGY_ARMED', `[${symbol}] SPOT OCO: TP ${tpPriceF}, SL ${slPriceF}`);
            } catch (ocoErr) {
                console.error(`[EXECUTION] SPOT OCO failed: ${ocoErr.message}`);
                try {
                    await exchange.createOrder(symbol, 'stop_loss_limit', exitSide, quantity, slPriceF, { stopPrice: slPriceF });
                    insertLog('FALLBACK_ARMED', `[${symbol}] SPOT SL fallback at ${slPriceF}`);
                } catch (fallbackErr) {
                    console.error(`[FAIL-SAFE] Critical: Failed to arm exit protection for ${symbol}: ${fallbackErr.message}`);
                    insertLog('CRITICAL_ERROR', `[${symbol}] Failed to arm exit protection!`);
                }
            }

        } else {
            // FUTURES: TAKE_PROFIT_MARKET + STOP_MARKET
            try {
                await exchange.createOrder(symbol, 'TAKE_PROFIT_MARKET', exitSide, quantity, tpPriceF, {
                    stopPrice: tpPriceF,
                    reduceOnly: true
                });
                console.log(`[EXECUTION] FUTURES TP at ${tpPriceF}`);
                insertLog('STRATEGY_ARMED', `[${symbol}] FUTURES TP: ${tpPriceF}`);
            } catch (tErr) { 
                console.error(`[EXECUTION] FUTURES TP error: ${tErr.message}`);
                insertLog('ERROR', `[${symbol}] TP arm failed: ${tErr.message}`);
            }

            try {
                await exchange.createOrder(symbol, 'STOP_MARKET', exitSide, quantity, slPriceF, {
                    stopPrice: slPriceF,
                    reduceOnly: true
                });
                console.log(`[EXECUTION] FUTURES SL at ${slPriceF}`);
                insertLog('STRATEGY_ARMED', `[${symbol}] FUTURES SL: ${slPriceF}`);
            } catch (sErr) { 
                console.error(`[EXECUTION] FUTURES SL error: ${sErr.message}`);
                insertLog('ERROR', `[${symbol}] SL arm failed: ${sErr.message}`);
            }
        }

        activePosition.tpTarget = tpPriceF;
        activePosition.slTarget = slPriceF;

        if (wss) broadcastMessage(wss, 'POSITION_OPENED', activePosition);

        return activePosition;

    } catch (error) {
        executionFailures++;
        console.error(`[EXECUTION] Critical failure (${executionFailures}/3): ${error.message}`);
        insertLog('CRITICAL_ERROR', `Trade execution failed for ${symbol}: ${error.message}`);

        // ── STABILIZATION: Circuit breaker increased to 5 minutes ──
        if (executionFailures >= 3) {
            console.error(`[FAIL-SAFE] CIRCUIT BREAKER ACTIVATED — Trading paused for 5 minutes.`);
            insertLog('CIRCUIT_BREAKER', 'Trading paused due to 3 consecutive execution failures.');
            circuitBreakerUntil = Date.now() + 300000; // 5 minutes
            executionFailures = 0;
        }
        return null;
    }
}
