import exchange, { IS_SPOT } from '../services/exchangeClient.js';

/**
 * Market Scanner - STABILIZATION: Locked to BTC/ETH/SOL whitelist only.
 * No longer drives stream rotation. Kept for potential future monitoring use.
 */

// ── STABILIZATION: Only these symbols are allowed ──
const ALLOWED_SYMBOLS = [
    'BTC/USDT', 'BTC/USDT:USDT',
    'ETH/USDT', 'ETH/USDT:USDT',
    'SOL/USDT', 'SOL/USDT:USDT',
];

export function isSymbolAllowed(symbol) {
    const normalized = symbol.replace('/', '').replace(':USDT', '').toUpperCase();
    return ALLOWED_SYMBOLS.some(s => s.replace('/', '').replace(':USDT', '').toUpperCase() === normalized);
}

export async function scanTopMarketOpportunities() {
    console.log(`[SCANNER] Scanning allowed symbols only: ${ALLOWED_SYMBOLS.join(', ')} [${IS_SPOT ? 'SPOT' : 'FUTURES'}]`);
    try {
        const tickers = await exchange.fetchTickers();
        
        let opportunities = [];

        for (const symbol in tickers) {
            const tk = tickers[symbol];
            
            // ── STABILIZATION: Whitelist filter ──
            if (!ALLOWED_SYMBOLS.includes(symbol)) continue;
            
            // Filtra por modo
            const isSpotSymbol    = symbol.endsWith('/USDT') && !symbol.includes(':');
            const isFutureSymbol  = symbol.includes(':USDT');
            const matchesMode = IS_SPOT ? isSpotSymbol : isFutureSymbol;
            
            if (!matchesMode) continue;

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

        opportunities.sort((a, b) => b.score - a.score);
        
        console.log(`[SCANNER] Allowed opportunities found: ${opportunities.length}`);
        opportunities.forEach((opt, idx) => console.log(`  ${idx+1}. ${opt.symbol} | Vol: $${(opt.volume/1e6).toFixed(0)}M | Score: ${opt.score.toFixed(2)}`));

        return opportunities;

    } catch (e) {
        console.error('[SCANNER] Scan failed:', e.message);
        return [];
    }
}
