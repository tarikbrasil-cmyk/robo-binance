import exchange from '../services/exchangeClient.js';

/**
 * Módulo Avançado: Orderbook Imbalance
 * Compara o volume total de Bids (compras paradas) vs o volume de Asks (vendas paradas)
 * nos limites próximos ao preço atual.
 */

export async function checkOrderbookImbalance(symbol, depth = 50) {
    try {
        const orderbook = await exchange.fetchOrderBook(symbol, depth);
        
        let totalBidsVolume = 0; // Volume financeiro para se defender (Comprar)
        let totalAsksVolume = 0; // Volume financeiro como teto (Vender)

        orderbook.bids.forEach(bid => {
            totalBidsVolume += (bid[0] * bid[1]); // preço * qty
        });

        orderbook.asks.forEach(ask => {
            totalAsksVolume += (ask[0] * ask[1]); // preço * qty
        });

        const imbalanceRatio = totalBidsVolume / (totalAsksVolume || 1); // EVITAR Div por Zero

        // Imbalance Score: 
        // > 1.5 : Pressão de compra esmagadora (Bids >>> Asks)
        // < 0.6 : Teto de venda forte (Asks >>> Bids)
        // entre 0.6 e 1.5 : Neutro

        let sentiment = 'NEUTRAL';
        if (imbalanceRatio > 1.5) sentiment = 'BULLISH';
        if (imbalanceRatio < 0.6) sentiment = 'BEARISH';

        return {
            imbalanceRatio,
            sentiment,
            totalBidsVolume,
            totalAsksVolume
        };

    } catch (e) {
        console.error(`[ORDERBOOK] Falha a ler L2 Depth para ${symbol}: ${e.message}`);
        return { sentiment: 'NEUTRAL' };
    }
}
