import WebSocket from 'ws';
import dotenv from 'dotenv';
import { broadcastMessage } from '../utils/websocket.js';
import { processMarketTick } from '../strategies/tradeObserver.js';

dotenv.config();

const isTestnet = process.env.BINANCE_TESTNET === 'true';
const BOT_MODE  = (process.env.BOT_MODE || 'FUTURES').toUpperCase();

// URLs por modo e ambiente
// SPOT    prod :  wss://stream.binance.com:9443/ws
// FUTURES demo :  wss://fstream.binancefuture.com/ws
// FUTURES prod :  wss://fstream.binance.com/ws
const WS_BASE_URL = BOT_MODE === 'SPOT'
    ? 'wss://stream.binance.com:9443/ws'
    : isTestnet
        ? 'wss://fstream.binancefuture.com/ws'
        : 'wss://fstream.binance.com/ws';

// Dicionario de streams ativos
let activeSockets = {};

export function startBinanceWebSocket(symbol, wssContext) {
    const streamSymbol = symbol.toLowerCase();
    
    // Evita duplicatas cegas
    if (activeSockets[streamSymbol]) {
        return; 
    }
    
    const endpoint = `${WS_BASE_URL}/${streamSymbol}@ticker`;
    
    console.log(`🔌 Conectando ao Binance WS: ${endpoint}`);
    const ws = new WebSocket(endpoint);
    activeSockets[streamSymbol] = ws;

    ws.on('open', () => {
        console.log(`✅ Conectado ao stream de ${streamSymbol.toUpperCase()}`);
    });

    ws.on('message', (data) => {
        try {
            const parsed = JSON.parse(data);
            if (parsed.e === '24hrTicker') {
                const tickerData = {
                    symbol: parsed.s,
                    price: parseFloat(parsed.c),
                    high: parseFloat(parsed.h),
                    low: parseFloat(parsed.l),
                    volume: parseFloat(parsed.v),
                    timestamp: parsed.E
                };

                if (tickerData.price <= 0) {
                    console.warn(`[WSS] Preço inválido recebido para ${parsed.s}: ${tickerData.price}`);
                    return;
                }

                // Sanity Check for major coins (prevent e.g. ETHUSDT at 0.9)
                if (parsed.s === 'ETHUSDT' && tickerData.price < 100) {
                    console.error(`[WSS] ANOMALIA DE PREÇO DETECTADA: ${parsed.s} a ${tickerData.price}. Ignorando Tick.`);
                    return;
                }
                if (parsed.s === 'BTCUSDT' && tickerData.price < 1000) {
                    console.error(`[WSS] ANOMALIA DE PREÇO DETECTADA: ${parsed.s} a ${tickerData.price}. Ignorando Tick.`);
                    return;
                }

                if (wssContext) {
                    broadcastMessage(wssContext, 'TICKER_UPDATE', tickerData);
                }

                processMarketTick(streamSymbol.toUpperCase(), tickerData.price, wssContext);
            }
        } catch (error) {
            console.error('Erro ao fazer parse do WebSocket da Binance:', error);
        }
    });

    ws.on('close', () => {
        console.log(`⚠️ Binance WS (${streamSymbol}) desconectado.`);
        delete activeSockets[streamSymbol];
    });

    ws.on('error', (err) => {
        console.error(`❌ Erro no Binance WS (${streamSymbol}):`, err.message);
    });
}

export function stopBinanceWebSocket(symbol) {
    const streamSymbol = symbol.toLowerCase();
    if (activeSockets[streamSymbol]) {
        activeSockets[streamSymbol].terminate();
        delete activeSockets[streamSymbol];
        console.log(`🛑 Binance WS ${streamSymbol} parado.`);
    }
}

export function flushAllWebSockets() {
    for (const sym in activeSockets) {
        activeSockets[sym].terminate();
        delete activeSockets[sym];
    }
    console.log(`🧹 Todos os streams WSS limpos.`);
}
