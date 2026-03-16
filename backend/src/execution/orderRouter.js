import exchange, { IS_SPOT, BOT_MODE } from '../services/exchangeClient.js';
import { insertLog, insertPnL } from '../database/db.js';
import { broadcastMessage } from '../utils/websocket.js';
import { calculatePositionSize } from '../risk/position_sizing.js';
import { detectMarketRegime, loadStrategyConfig } from '../strategy/regime_engine.js';
import { activeTrades } from './tradeMonitor.js';

/**
 * Controller principal de roteamento de ordens.
 * Suporta SPOT e FUTURES via BOT_MODE no .env
 *
 * SPOT:    sem leverage, sem short, TP via LIMIT, SL via STOP_LOSS_LIMIT
 * FUTURES: margem ISOLADA, leverage, TAKE_PROFIT_MARKET + STOP_MARKET
 */

let executionFailures = 0;
let circuitBreakerUntil = 0;

export async function executeTradeSequence(symbol, side, currentPrice, wss, strategyData = {}) {
    // 0. Circuit Breaker check
    if (Date.now() < circuitBreakerUntil) {
        console.warn(`[EXECUTION] Circuit Breaker ativo. Trading pausado.`);
        return null;
    }

    // 1. Position Locking
    if (activeTrades[symbol]) {
        console.log(`[EXECUTION] Posição Ativa bloqueia nova entrada para ${symbol}. Ignorado.`);
        return null;
    }

    // Em SPOT, apenas BUY é permitido (não há short)
    if (IS_SPOT && side === 'SELL') {
        console.log(`[EXECUTION] Modo SPOT: sinal SELL ignorado (sem short em Spot).`);
        return null;
    }

    try {
        const balanceInfo = await exchange.fetchBalance();
        // SPOT usa saldo 'free', FUTURES usa 'total' da margin
        const availableBalance = IS_SPOT
            ? (balanceInfo.free?.USDT || 0)
            : (balanceInfo.total?.USDT || 0);

        const config = loadStrategyConfig();
        
        // Capping global risk
        const positionalData = calculatePositionSize({
            accountBalance: availableBalance,
            entryPrice: currentPrice,
            stopLossPrice: strategyData.stopLossPrice || currentPrice,
            config: config,
            indicator: strategyData.indicator || null,
        });

        if (positionalData.positionSizeUSDT <= 0) {
            console.log(`[EXECUTION] Risco declinado (Drawdown / Math Limits) para ${side} em ${symbol}`);
            return null;
        }

        const positionalUSDT = positionalData.positionSizeUSDT;
        // Obter parametros da strategy ativa
        let leverage = 10;
        let takeProfitPerc = 0.05;
        let stopLossPerc = 0.03;
        
        if (strategyData.strategy === 'EMA_TREND') {
            leverage = config.trendStrategy.leverage || 20;
            takeProfitPerc = config.trendStrategy.takeProfit;
            stopLossPerc = config.trendStrategy.stopLoss;
        } else if (strategyData.strategy === 'VWAP_MEAN_REVERSION') {
            leverage = config.trendStrategy.leverage || 20;
            // TP/SL do VWAP vêm de distância não de % fixas
            takeProfitPerc = Math.abs(strategyData.takeProfitPrice - currentPrice) / currentPrice;
            stopLossPerc = Math.abs(strategyData.stopLossPrice - currentPrice) / currentPrice;
        }

        await exchange.loadMarkets();

        let quantity;

        if (IS_SPOT) {
            // SPOT: sem leverage, quantidade simples = USDT / preço
            const rawQuantity = (positionalUSDT * 0.98) / currentPrice;
            quantity = parseFloat(exchange.amountToPrecision(symbol, rawQuantity));
            console.log(`[EXECUTION] SPOT BUY ${quantity} ${symbol} @ ~${currentPrice}`);
        } else {
            // FUTURES: aplica leverage e margin mode
            await exchange.setLeverage(leverage, symbol);
            try {
                await exchange.setMarginMode('ISOLATED', symbol);
            } catch (mErr) { /* Já em ISOLATED */ }

            // FIX: positionalUSDT already represents the risk-adjusted notional.
            // If positionalUSDT is the notional, then quantity = positionalUSDT / price.
            // The previous code did (positionalUSDT * leverage), which was incorrect if positionalUSDT was already scaled or meant as notional.
            // Based on position_sizing.js: positionalUSDT = riskAmountUSDT / stopDistancePct, capped by accountBalance * leverage.
            // So positionalUSDT IS the intended notional exposure.
            const notional = positionalUSDT * 0.98; 
            const rawQuantity = notional / currentPrice;
            quantity = parseFloat(exchange.amountToPrecision(symbol, rawQuantity));
            
            console.log(`[EXECUTION] FINAL PARAMETERS: ${symbol} | Side: ${side} | Price: ${currentPrice} | Qty: ${quantity} | Notional: ${notional.toFixed(2)} USDT | Lev: ${leverage}x`);
        }

        // 2. Execution Guards & Exchange Filters
        const market = exchange.market(symbol);
        const minQty = market.limits.amount.min || 0;
        const maxQty = market.limits.amount.max || Infinity;
        const minNotional = market.limits.cost.min || 0;

        if (quantity < minQty) {
            console.error(`[EXECUTION] Orcem REJEITADA: Quantidade ${quantity} < Min ${minQty} em ${symbol}`);
            return null;
        }
        if (quantity > maxQty) {
            console.error(`[EXECUTION] Orcem REJEITADA: Quantidade ${quantity} > Max ${maxQty} em ${symbol}`);
            return null;
        }
        if (quantity * currentPrice < minNotional) {
            console.error(`[EXECUTION] Orcem REJEITADA: Notional ${(quantity * currentPrice).toFixed(2)} < Min ${minNotional} em ${symbol}`);
            return null;
        }
        if (currentPrice <= 0) {
            console.error(`[EXECUTION] Orcem REJEITADA: Preço inválido (${currentPrice})`);
            return null;
        }

        // Executa ordem de entrada
        let entryOrder = await exchange.createMarketOrder(symbol, side, quantity);
        
        // Reset failures on success
        executionFailures = 0;
        let entryPrice = entryOrder.average || currentPrice;

        insertLog('TRADE_OPENED', `[${symbol}] ${side} executado a ${entryPrice} (Qtd: ${quantity})`);

        const activePosition = {
            symbol,
            side,
            entryPrice,
            quantity,
            leverage: IS_SPOT ? 1 : (leverage || 10),
            timestamp: Date.now(),
            mode: BOT_MODE
        };

        // Define side de saída
        const exitSide = IS_SPOT ? 'SELL' : (side === 'BUY' ? 'SELL' : 'BUY');

        // Preços alvo de TP e SL
        const tpTarget = side === 'BUY'
            ? entryPrice * (1 + takeProfitPerc)
            : entryPrice * (1 - takeProfitPerc);
        const slTarget = side === 'BUY'
            ? entryPrice * (1 - stopLossPerc)
            : entryPrice * (1 + stopLossPerc);

        const tpPriceF = parseFloat(exchange.priceToPrecision(symbol, tpTarget));
        const slPriceF = parseFloat(exchange.priceToPrecision(symbol, slTarget));

        const adx = strategyData.indicator?.adx;
        const trendThresh = config.regime.trendAdxThreshold;
        const rangeThresh = config.regime.rangingAdxThreshold;
        const regime = adx > trendThresh ? 'TREND' : (adx < rangeThresh ? 'RANGE' : 'NEUTRAL');
        
        const volMult = (strategyData.indicator?.volume / strategyData.indicator?.volSma20).toFixed(2);

        console.log(`\n==================================================`);
        console.log(`               TRADE SIGNAL INFO (V2)`);
        console.log(`==================================================`);
        console.log(`Symbol:          ${symbol}`);
        console.log(`Strategy:        ${strategyData.strategy}`);
        console.log(`Regime:          ${regime}`);
        console.log(`ADX:             ${adx?.toFixed(2)}`);
        console.log(`ATR:             ${strategyData.indicator?.atr?.toFixed(2)}`);
        console.log(`ATR%:            ${(strategyData.indicator?.atrPercent * 100).toFixed(3)}%`);
        console.log(`Z-Score:         ${strategyData.indicator?.zscore?.toFixed(2) || 'N/A'}`);
        console.log(`Vol Multiplier:  ${volMult}x`);
        console.log(`--------------------------------------------------`);
        console.log(`Entry:           ${entryPrice.toFixed(2)}`);
        console.log(`Stop:            ${slPriceF.toFixed(2)}`);
        console.log(`TP:              ${tpPriceF.toFixed(2)}`);
        console.log(`==================================================\n`);

        if (IS_SPOT) {
            // SPOT: OCO (One-Cancels-the-Other) para colocar TP e SL sem travar saldo 2x
            try {
                // Preço de Stop Limit levemente abaixo do Stop Price para garantir execução em quedas rápidas
                // Usando uma margem de 0.5% para o Stop Limit em relação ao Stop Price
                const slLimitPrice = parseFloat(exchange.priceToPrecision(symbol, slPriceF * 0.995));
                
                const ocoParams = {
                    symbol: symbol.replace('/', '').split(':')[0], // Formato BTCUSDT
                    side: exitSide,
                    quantity: quantity,
                    price: tpPriceF,               // Preço do Take Profit (Limit)
                    stopPrice: slPriceF,           // Preço do Trigger do Stop Loss
                    stopLimitPrice: slLimitPrice,  // Preço de Execução do Stop Loss
                    stopLimitTimeInForce: 'GTC'
                };

                console.log(`[EXECUTION] [${BOT_MODE}] Enviando OCO: TP=${tpPriceF}, SL=${slPriceF}, Limit=${slLimitPrice}`);
                await exchange.privatePostOrderOco(ocoParams);
                
                insertLog('STRATEGY_ARMED', `[${symbol}] ${BOT_MODE} OCO posicionado: TP ${tpPriceF}, SL ${slPriceF}`);
                console.log(`[EXECUTION] SPOT: OCO Posicionado com sucesso.`);
            } catch (ocoErr) {
                console.error(`[EXECUTION] [${BOT_MODE}] Falha ao posicionar OCO: ${ocoErr.message}`);
                try {
                    console.log(`[EXECUTION] Tentando SL Fallback...`);
                    await exchange.createOrder(symbol, 'stop_loss_limit', exitSide, quantity, slPriceF, { stopPrice: slPriceF });
                    insertLog('FALLBACK_ARMED', `[${symbol}] SPOT SL Fallback posicionado a ${slPriceF}`);
                } catch (fallbackErr) {
                    console.error(`[EXECUTION] Falha crítica no Fallback de SL: ${fallbackErr.message}`);
                    insertLog('CRITICAL_ERROR', `[${symbol}] Falha ao armar proteções de saída!`);
                }
            }

        } else {
            // FUTURES: TAKE_PROFIT_MARKET + STOP_MARKET com reduceOnly
            try {
                await exchange.createOrder(symbol, 'TAKE_PROFIT_MARKET', exitSide, quantity, tpPriceF, {
                    stopPrice: tpPriceF,
                    reduceOnly: true
                });
                console.log(`[EXECUTION] [${BOT_MODE}] TP posicionado a ${tpPriceF}`);
                insertLog('STRATEGY_ARMED', `[${symbol}] FUTURES TP posicionado: ${tpPriceF}`);
            } catch (tErr) { 
                console.error(`[EXECUTION] [${BOT_MODE}] Erro TP: ${tErr.message}`);
                insertLog('ERROR', `[${symbol}] Erro ao armar TP em Futuros: ${tErr.message}`);
            }

            try {
                await exchange.createOrder(symbol, 'STOP_MARKET', exitSide, quantity, slPriceF, {
                    stopPrice: slPriceF,
                    reduceOnly: true
                });
                console.log(`[EXECUTION] [${BOT_MODE}] SL posicionado a ${slPriceF}`);
                insertLog('STRATEGY_ARMED', `[${symbol}] FUTURES SL posicionado: ${slPriceF}`);
            } catch (sErr) { 
                console.error(`[EXECUTION] [${BOT_MODE}] Erro SL: ${sErr.message}`);
                insertLog('ERROR', `[${symbol}] Erro ao armar SL em Futuros: ${sErr.message}`);
            }
        }

        activePosition.tpTarget = tpPriceF;
        activePosition.slTarget = slPriceF;

        if (wss) broadcastMessage(wss, 'POSITION_OPENED', activePosition);

        return activePosition;

    } catch (error) {
        executionFailures++;
        console.error(`[EXECUTION ENGINE] [${BOT_MODE}] Falha crítica (${executionFailures}/3): ${error.message}`);
        insertLog('CRITICAL_ERROR', `Falha ao executar trade ${symbol}: ${error.message}`);

        if (executionFailures >= 3) {
            console.error(`[EXECUTION] CIRCUIT BREAKER ATIVADO - Pausando trading por 60 segundos.`);
            insertLog('CRITICAL_EXECUTION_PAUSE', 'Circuito interrompido devido a falhas consecutivas.');
            circuitBreakerUntil = Date.now() + 60000;
            executionFailures = 0; // Reset after pause starts
        }
        return null;
    }
}
