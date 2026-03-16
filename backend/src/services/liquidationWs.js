import WebSocket from 'ws';
import dotenv from 'dotenv';
import { broadcastMessage } from '../utils/websocket.js';
import { analyzeLiquidationSpike } from '../strategies/liquidityEngine.js';

dotenv.config();

const isTestnet = process.env.BINANCE_TESTNET !== 'false';
const WS_BASE_URL = isTestnet 
  ? 'wss://stream.binancefuture.com/ws' 
  : 'wss://fstream.binance.com/ws';

let liqSocket = null;

// Conecta no stream de TODAS as liquidações do mercado futuro (!forceOrder@arr)
export function startLiquidationStream(wssContext) {
    if (liqSocket) return;

    const endpoint = `${WS_BASE_URL}/!forceOrder@arr`;
    console.log(`🔌 Conectando ao Liquidation Feed Global: ${endpoint}`);
    
    liqSocket = new WebSocket(endpoint);

    liqSocket.on('open', () => {
        console.log(`✅ Liquidation Feed Global Ativo.`);
    });

    liqSocket.on('message', (data) => {
        try {
            const parsed = JSON.parse(data);
            
            // Binance manda array ou obj individual dependendo do stream (arr vs simples)
            const events = Array.isArray(parsed) ? parsed : [parsed];
            
            events.forEach(ev => {
                if (ev.e === 'forceOrder') {
                    const liqData = {
                        symbol: ev.o.s,
                        side: ev.o.S, // SELL (Long liquidado) ou BUY (Short liquidado)
                        price: parseFloat(ev.o.p),
                        quantity: parseFloat(ev.o.q),
                        timestamp: ev.E
                    };
                    
                    const notionalVolume = liqData.price * liqData.quantity;

                    // O Liquidity Engine vai avaliar se isso é um Spike formador de oportunidade
                    analyzeLiquidationSpike(liqData.symbol, liqData.side, notionalVolume, wssContext);
                    
                    if (wssContext) {
                        broadcastMessage(wssContext, 'LIQUIDATION_EVENT', liqData);
                    }
                }
            });

        } catch (error) {
            console.error('Erro de parse no Liquidation Stream:', error);
        }
    });

    liqSocket.on('close', () => {
        console.log('⚠️ Liquidation Feed WS desconectado. Reconectando...');
        liqSocket = null;
        setTimeout(() => startLiquidationStream(wssContext), 5000);
    });
}
