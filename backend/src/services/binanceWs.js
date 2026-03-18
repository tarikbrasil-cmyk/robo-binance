import WebSocket from 'ws';
import dotenv from 'dotenv';
import { broadcastMessage } from '../utils/websocket.js';
import { processMarketTick } from '../strategies/tradeObserver.js';

dotenv.config();

const isTestnet = process.env.BINANCE_TESTNET === 'true';
const BOT_MODE  = (process.env.BOT_MODE || 'FUTURES').toUpperCase();

const WS_BASE_URL = BOT_MODE === 'SPOT'
    ? 'wss://stream.binance.com:9443/ws'
    : isTestnet
        ? 'wss://fstream.binancefuture.com/ws'
        : 'wss://fstream.binance.com/ws';

// ── STABILIZATION: Persistent streams with reconnection ──
let activeSockets = {};
let reconnectAttempts = {};
const MAX_RECONNECT_DELAY = 30000; // 30 seconds max

function getReconnectDelay(symbol) {
    const attempts = reconnectAttempts[symbol] || 0;
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max
    return Math.min(1000 * Math.pow(2, attempts), MAX_RECONNECT_DELAY);
}

export function startBinanceWebSocket(symbol, wssContext) {
    const streamSymbol = symbol.toLowerCase();
    
    // Prevent duplicate connections
    if (activeSockets[streamSymbol] && activeSockets[streamSymbol].readyState === WebSocket.OPEN) {
        console.log(`[WS] Stream ${streamSymbol.toUpperCase()} already active, skipping.`);
        return; 
    }
    
    const endpoint = `${WS_BASE_URL}/${streamSymbol}@ticker`;
    
    console.log(`[WS] Connecting to Binance stream: ${streamSymbol.toUpperCase()}`);
    const ws = new WebSocket(endpoint);
    activeSockets[streamSymbol] = ws;

    ws.on('open', () => {
        console.log(`[WS] ✅ Connected: ${streamSymbol.toUpperCase()}`);
        // Reset reconnection counter on successful connect
        reconnectAttempts[streamSymbol] = 0;
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
                    console.warn(`[WS] Invalid price for ${parsed.s}: ${tickerData.price}`);
                    return;
                }

                // Sanity checks for major coins
                if (parsed.s === 'ETHUSDT' && tickerData.price < 100) {
                    console.error(`[WS] PRICE ANOMALY: ${parsed.s} at ${tickerData.price}. Ignoring.`);
                    return;
                }
                if (parsed.s === 'BTCUSDT' && tickerData.price < 1000) {
                    console.error(`[WS] PRICE ANOMALY: ${parsed.s} at ${tickerData.price}. Ignoring.`);
                    return;
                }

                if (wssContext) {
                    broadcastMessage(wssContext, 'TICKER_UPDATE', tickerData);
                }

                processMarketTick(streamSymbol.toUpperCase(), tickerData.price, wssContext);
            }
        } catch (error) {
            console.error(`[WS] Parse error:`, error.message);
        }
    });

    // ── STABILIZATION: Auto-reconnect with exponential backoff ──
    ws.on('close', () => {
        console.warn(`[WS] ⚠️ Disconnected: ${streamSymbol.toUpperCase()}`);
        delete activeSockets[streamSymbol];
        
        reconnectAttempts[streamSymbol] = (reconnectAttempts[streamSymbol] || 0) + 1;
        const delay = getReconnectDelay(streamSymbol);
        
        console.log(`[WS] Reconnecting ${streamSymbol.toUpperCase()} in ${delay/1000}s (attempt ${reconnectAttempts[streamSymbol]})`);
        setTimeout(() => {
            startBinanceWebSocket(symbol, wssContext);
        }, delay);
    });

    ws.on('error', (err) => {
        console.error(`[WS] ❌ Error on ${streamSymbol.toUpperCase()}: ${err.message}`);
        // Error will trigger 'close' which handles reconnection
    });
}

export function stopBinanceWebSocket(symbol) {
    const streamSymbol = symbol.toLowerCase();
    if (activeSockets[streamSymbol]) {
        // Clear reconnect so it doesn't auto-reconnect after stop
        reconnectAttempts[streamSymbol] = Infinity;
        activeSockets[streamSymbol].terminate();
        delete activeSockets[streamSymbol];
        console.log(`[WS] 🛑 Stream ${streamSymbol.toUpperCase()} stopped.`);
    }
}
