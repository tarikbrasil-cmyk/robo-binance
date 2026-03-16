import exchange, { IS_SPOT } from '../services/exchangeClient.js';

/**
 * Market Scanner - Analisa as melhores top moedas do mercado (Spot ou Futures)
 * 1. Pega tickers 24hr de todos pares USDT
 * 2. Filtra por modo (Spot: BTC/USDT | Futures: BTC/USDT:USDT)
 * 3. Filtra Volume > 100M e classifica Top 5 por Score de Oportunidade
 */

export async function scanTopMarketOpportunities() {
    console.log(`[MARKET SCANNER] Iniciando varredura das Top Oportunidades [${IS_SPOT ? 'SPOT' : 'FUTURES'}]...`);
    try {
        const tickers = await exchange.fetchTickers();
        
        let opportunities = [];

        for (const symbol in tickers) {
            const tk = tickers[symbol];
            
            // Filtra por modo:
            // SPOT:    símbolo termina em /USDT e NÃO tem sufixo :USDT (ex: BTC/USDT)
            // FUTURES: símbolo termina em :USDT (ex: BTC/USDT:USDT)
            const isSpotSymbol    = symbol.endsWith('/USDT') && !symbol.includes(':');
            const isFutureSymbol  = symbol.includes(':USDT');
            
            const matchesMode = IS_SPOT ? isSpotSymbol : isFutureSymbol;
            
            // Descarta stablecoins
            const isStable = symbol.includes('USDC') || symbol.includes('BUSD') || 
                             symbol.includes('TUSD') || symbol.includes('FDUSD');

            if (!matchesMode || isStable) continue;

            // Volume Filtro Básico (> $100M 24hr)
            if (tk.quoteVolume && tk.quoteVolume > 100000000) {
                const volatilityRaw = ((tk.high - tk.low) / tk.last) || 0;
                const momentum = Math.abs(tk.percentage || 0);
                const score = (volatilityRaw * 100 * 0.3) + (momentum * 0.2);

                opportunities.push({
                    symbol: tk.symbol,
                    volume: tk.quoteVolume,
                    volatilityPct: (volatilityRaw * 100).toFixed(2),
                    momentum: tk.percentage,
                    score
                });
            }
        }

        // Ordena por Score DESC e pega Top 5
        opportunities.sort((a, b) => b.score - a.score);
        const top5 = opportunities.slice(0, 5);
        
        console.log('[MARKET SCANNER] Top 5 Oportunidades ranqueadas:');
        top5.forEach((opt, idx) => console.log(` ${idx+1}. ${opt.symbol} (Score: ${opt.score.toFixed(2)})`));

        return top5;

    } catch (e) {
        console.error('[MARKET SCANNER] Falha na rolagem do Scanner:', e.message);
        return [];
    }
}
