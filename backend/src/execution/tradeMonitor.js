import exchange, { IS_SPOT, BOT_MODE } from '../services/exchangeClient.js';
import { broadcastMessage } from '../utils/websocket.js';
import { insertPnL } from '../database/db.js';

/**
 * Trade Monitor - Gerencia Posições Abertas e Atualiza Trailing Stop
 */

// Armazena referencias ativas de picos de moedas
// Estrutura: { symbol: { highestPrice: num, entryPrice: num, side: str, slTarget: num, tsActive: bool } }
export const activeTrades = {}; 

const ACTIVATION_PCT = 0.03; // 3% p/ ativar TS
const TRAILING_DISTANCE = 0.015; // 1.5% do pico

export async function monitorActiveTrade(symbol, currentPrice, wss) {
    const trade = activeTrades[symbol];
    if (!trade) return;

    const isLong = trade.side === 'BUY';
    const roePercVal = isLong 
        ? ((currentPrice - trade.entryPrice) / trade.entryPrice) 
        : ((trade.entryPrice - currentPrice) / trade.entryPrice);

    // Identifica e atualiza o "Pico" de lucro
    if (isLong) {
        if (currentPrice > trade.highestPrice) trade.highestPrice = currentPrice;
    } else {
        if (currentPrice < trade.highestPrice) trade.highestPrice = currentPrice; // Para shorts, highest é o menor numero
    }

    // Checa se o cruzou o limite para ATIVAR Trailing
    if (!trade.tsActive && roePercVal >= ACTIVATION_PCT) {
        trade.tsActive = true;
        console.log(`[TRADE MONITOR] ${symbol} alcançou +3% de ROE! Trailing Stop ATIVADO.`);
    }

    // Atualiza linha de SL Móvel 
    if (trade.tsActive) {
        let newSlPrice;
        if (isLong) {
            newSlPrice = trade.highestPrice * (1 - TRAILING_DISTANCE);
            // So sobe o stop, nunca desce
            if (newSlPrice > trade.slTarget) {
                trade.slTarget = newSlPrice;
                await updateExchangeStop(symbol, trade.side, newSlPrice, trade.quantity);
            }
        } else {
            newSlPrice = trade.highestPrice * (1 + TRAILING_DISTANCE);
            if (newSlPrice < trade.slTarget) {
                // Short Stops andam pra baixo
                trade.slTarget = newSlPrice;
                await updateExchangeStop(symbol, trade.side, newSlPrice, trade.quantity);
            }
        }
    }
}

async function updateExchangeStop(symbol, entrySide, newStopPrice, quantity) {
    try {
        await exchange.cancelAllOrders(symbol);
        
        await exchange.loadMarkets();
        const cleanPrice = parseFloat(exchange.priceToPrecision(symbol, newStopPrice));
        
        const exitSide = entrySide === 'BUY' ? 'SELL' : 'BUY';
        
        if (IS_SPOT) {
            // SPOT: usar STOP_LOSS_LIMIT em vez de STOP_MARKET
            await exchange.createOrder(symbol, 'stop_loss_limit', exitSide, quantity, cleanPrice, {
                stopPrice: cleanPrice
            });
        } else {
            await exchange.createOrder(symbol, 'STOP_MARKET', exitSide, quantity, cleanPrice, {
                stopPrice: cleanPrice,
                reduceOnly: true
            });
        }

        console.log(`[TRAILING STOP] ${symbol} SL Dinâmico atualizado para ${cleanPrice}`);
    } catch (e) {
        console.error(`[TRAILING STOP] Falha ao mover o SL dinâmico: ${e.message}`);
    }
}

/**
 * Função para sincronizar Posições com a API REST 
 * Identificando StopLoss ou TakeProfits que já foram preenchidos (closed)
 */
export async function syncPositionsFromExchange(wss = null) {
    try {
        if (IS_SPOT) {
            // SPOT: verifica ordens abertas por símbolo em vez de positions (que é exclusivo de futuros)
            for (const symbol in activeTrades) {
                try {
                    const openOrders = await exchange.fetchOpenOrders(symbol);
                    
                    // Se o ativo está em activeTrades, esperamos as ordens de TP e SL (ou o OCO)
                    // Se não houver ordens abertas, o trade encerrou via Market ou por algum outro motivo
                    if (openOrders.length === 0 || openOrders.length === 1) {
                        console.log(`[TRADE MONITOR] [SPOT] Encerramento detectado para ${symbol}. Sincronizando PnL...`);
                        
                        // Busca ordens fechadas recentemente para este símbolo
                        const closedOrders = await exchange.fetchClosedOrders(symbol, undefined, 5);
                        const lastExitOrder = closedOrders.reverse().find(o => o.side === (activeTrades[symbol].side === 'BUY' ? 'SELL' : 'BUY'));

                        if (lastExitOrder) {
                            const exitPrice = lastExitOrder.price || lastExitOrder.average;
                            const entryPrice = activeTrades[symbol].entryPrice;
                            const quantity = activeTrades[symbol].quantity;
                            
                            const profitUsdt = (exitPrice - entryPrice) * quantity;
                            const roePerc = (profitUsdt / (entryPrice * quantity)) * 100;

                            await insertPnL(symbol, activeTrades[symbol].side, entryPrice, exitPrice, profitUsdt, roePerc, {
                                type: 'SPOT',
                                leverage: 1,
                                contracts: quantity,
                                status: 'CLOSED'
                            });
                            console.log(`[TRADE MONITOR] [SPOT] PnL Registrado: ${symbol} | Lucro: $${profitUsdt.toFixed(2)} (${roePerc.toFixed(2)}%)`);
                        }

                        if (openOrders.length === 1) {
                            console.log(`[TRADE MONITOR] [SPOT] ${symbol} com 1 ordem órfã detectada. Cancelando...`);
                            await exchange.cancelAllOrders(symbol);
                        }
                        
                        delete activeTrades[symbol];
                if (wss) broadcastMessage(wss, 'SYNC_UPDATE', { symbol, action: 'closed' });
                    }
                } catch (symErr) {
                    console.error(`[TRADE MONITOR] [${BOT_MODE || 'UNKNOWN'}] Erro ao sincronizar ${symbol}: ${symErr.message}`);
                }
            }
            return;
        }

        // FUTURES: usa fetchPositions normal
        const positions = await exchange.fetchPositions();
        
        for (const symbol in activeTrades) {
            const exchangePos = positions.find(p => p.symbol === symbol && Math.abs(parseFloat(p.contracts || p.positionAmt || 0)) > 0);
            if (!exchangePos) {
                console.log(`[TRADE MONITOR] [FUTURES] Posição finalizada via API Sync para ${symbol}.`);
                
                // Em futuros, pegamos os dados reais do trade arquivado para salvar no DB
                const trade = activeTrades[symbol];
                const profitUsdt = 0; // Seria melhor buscar o PnL Realizado via fetchMyTrades
                const roePerc = 0;

                await insertPnL(symbol, trade.side, trade.entryPrice, 0, profitUsdt, roePerc, {
                    type: 'FUTURES',
                    leverage: trade.leverage || 10,
                    contracts: trade.quantity,
                    status: 'CLOSED'
                });

                delete activeTrades[symbol];
                if (wss) broadcastMessage(wss, 'SYNC_UPDATE', { symbol, action: 'closed' });
            }
        }
    } catch (e) {
        // -1109: conta de futuros ainda não inicializada ou sem atividade no Demo Trading
        if (e.message && (e.message.includes('-1109') || e.message.includes('not supported'))) {
            // Silencioso para não poluir o console em contas novas
            return;
        }
        const currentMode = typeof BOT_MODE !== 'undefined' ? BOT_MODE : 'UNKNOWN';
        console.error(`[TRADE MONITOR] [${currentMode}] Erro crítico no Sync: ${e.message}`);
    }
}
