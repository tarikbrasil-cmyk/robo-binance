import { riskManager } from '../risk/riskManager.js';
import { executeTradeSequence } from '../execution/orderRouter.js';

/**
 * Liquidity Engine
 * Avalia picos de liquidação (Liquidation Pressure) para tentar entradas 'Reversal' em pontos de exaustão.
 */

// Armazena as liquidações acumuladas na janela de tempo (ex: 5 minutos)
const liquidationCache = {}; 
const SPIKE_THRESHOLD_USDT = 500000; // $500k liquidados em um único respiro é um spike massivo (Ajustado pra Testnet/Dev)

export async function analyzeLiquidationSpike(symbol, liquidatedSide, volumeUsdt, wss) {
    if (!riskManager.canOpenNewPosition()) return;

    if (!liquidationCache[symbol]) {
        liquidationCache[symbol] = { longLiq: 0, shortLiq: 0, lastCheck: Date.now() };
    }

    // Acumula na janela
    if (Date.now() - liquidationCache[symbol].lastCheck > 60000 * 5) {
        // Reseta a cada 5 min
        liquidationCache[symbol] = { longLiq: 0, shortLiq: 0, lastCheck: Date.now() };
    }

    if (liquidatedSide === 'SELL') {
        // Alguém que estava Long foi forçado a Vender
        liquidationCache[symbol].longLiq += volumeUsdt;
    } else {
        // Alguém que estava Short foi forçado a Comprar
        liquidationCache[symbol].shortLiq += volumeUsdt;
    }

    // Avalia Cenário 1: Reversal de Exaustão de Compra (Short Liquidation Spike) -> Preço subiu mto e liquidou os bears, reverte pra SHORT
    if (liquidationCache[symbol].shortLiq >= SPIKE_THRESHOLD_USDT) {
        console.log(`[LIQUIDITY ENGINE] 🩸 SHORT Squeeze Massivo em ${symbol} (>$${(liquidationCache[symbol].shortLiq/1000).toFixed(0)}k). Possível exaustão compradora.`);
        
        // Resetamos temporariamente pra não flodar ordens
        liquidationCache[symbol].shortLiq = 0; 

        // Tentativa de Pegar Faca Caindo (Reversal Short)
        // ConfidenceScore agressivo pois Liquidity Sweeps costumam pagar rápido
        await attemptReversalTrade(symbol, 'SELL', 0.9, wss);
    }
    
    // Avalia Cenário 2: Reversal de Exaustão de Venda (Long Liquidation Spike) -> Preço caiu mto e liquidou bulls, reverte pra LONG
    else if (liquidationCache[symbol].longLiq >= SPIKE_THRESHOLD_USDT) {
        console.log(`[LIQUIDITY ENGINE] 🩸 LONG Cascade Massivo em ${symbol} (>$${(liquidationCache[symbol].longLiq/1000).toFixed(0)}k). Market Makers caçaram stops.`);
        
        liquidationCache[symbol].longLiq = 0; 
        
        await attemptReversalTrade(symbol, 'BUY', 0.9, wss);
    }
}

async function attemptReversalTrade(symbol, side, confidence, wss) {
    // Para simplificação de MVP, pega preço aproximado pelo book ticker ou null (ordem market preenche em curPrice)
    // O ideal seria pegar do CCXT rápido
    import('../services/exchangeClient.js').then(async ({ default: exchange }) => {
        try {
            await exchange.loadMarkets();
            const tick = await exchange.fetchTicker(symbol);
            
            console.log(`[LIQUIDITY ENGINE] Disparando Ordem Sweep Reversal. ALVO: ${side} @~${tick.last}`);
            await executeTradeSequence(symbol, side, confidence, tick.last, wss);
            
        } catch(e) {
            console.error('[LIQUIDITY ENGINE] Erro ao tentar Reversal Trade:', e.message);
        }
    });
}
