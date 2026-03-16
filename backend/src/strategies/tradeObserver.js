import { getFundingRate, fetchRecentKlines } from '../data/marketData.js';
import { executeTradeSequence } from '../execution/orderRouter.js';
import { riskManager } from '../risk/riskManager.js';
import { activeTrades, monitorActiveTrade } from '../execution/tradeMonitor.js';
import { checkOrderbookImbalance } from './orderbookEngine.js';
import { calculateIndicators, loadStrategyConfig, detectMarketRegime, isMarketConditionAllowed } from '../strategy/regime_engine.js';
import { evaluateMomentumBreakoutStrategy } from '../strategy/momentum_breakout_strategy.js';
import { evaluateVwapZScoreStrategy } from '../strategy/vwap_zscore_strategy.js';

export async function processMarketTick(symbol, currentPrice, wss) {
    if (!riskManager.canOpenNewPosition()) return;
    
    // Se a moeda ESTÁ EM POSIÇÃO localmente e na exchange, faça o Monitoramento Constante e NÃO abra nova entrada!
    if (activeTrades[symbol]) {
        // Verifica TS progressão
        await monitorActiveTrade(symbol, currentPrice, wss);
        return; 
    }

    try {
        const config = loadStrategyConfig();
        const klines = await fetchRecentKlines(symbol, '1m', 200);
        
        if (!klines || klines.length < 200) return;
        
        const indicators = calculateIndicators(klines);
        const candleObj = klines[klines.length - 1]; // latest
        
        const currentInd = indicators[indicators.length - 1];
        const prevInd = indicators[indicators.length - 2];
        
        if (!isMarketConditionAllowed(currentInd, candleObj, config)) {
            return;
        }

        const regime = detectMarketRegime(currentInd, config);
        
        let signalData = null;
        if (regime === 'TREND') {
            signalData = evaluateMomentumBreakoutStrategy(candleObj, currentInd, config);
        } else if (regime === 'RANGE') {
            signalData = evaluateVwapZScoreStrategy(candleObj, currentInd, config);
        } else {
            // NEUTRAL: do not open new positions, just monitor (handled by monitorActiveTrade at start)
            return;
        }

        if (signalData && (signalData.signal === 'BUY' || signalData.signal === 'SELL')) {
            const fundingRate = await getFundingRate(symbol);
            const absFunding = Math.abs(parseFloat(fundingRate));
            
            // Funding filter
            if (absFunding > config.general.fundingRateFilter) {
                 console.log(`[CORE] Trade cancelado. Funding Extremo (${absFunding}). Preservando margem.`);
                 return;
            }
            
            const obStatus = await checkOrderbookImbalance(symbol, 20);
            
            // Fortalece Trust
            if ((signalData.signal === 'BUY' && obStatus.sentiment === 'BULLISH') || 
                (signalData.signal === 'SELL' && obStatus.sentiment === 'BEARISH')) {
                console.log(`[CORE] Confirmação Dupla! Regime ${regime} + Orderbook Alinhados`);
            } else if ((signalData.signal === 'BUY' && obStatus.sentiment === 'BEARISH') ||
                     (signalData.signal === 'SELL' && obStatus.sentiment === 'BULLISH')) {
                console.warn(`[CORE] Trade cancelado. Orderbook está oposto ao Regime (${regime}). Preservando margem.`);
                return;
            }

            console.log(`[CORE] Sinal ${signalData.signal} recebido (${signalData.strategy}). Roteando Ordem.`);
            
            // Pass indicators down to Order Router for Positional sizing formulas
            signalData.indicator = currentInd;

            // Roteia pra ordem
            const pos = await executeTradeSequence(symbol, signalData.signal, currentPrice, wss, signalData);
            
            if (pos) {
                activeTrades[symbol] = {
                    symbol,
                    side: pos.side,
                    entryPrice: pos.entryPrice,
                    quantity: pos.quantity,
                    highestPrice: currentPrice, 
                    slTarget: pos.slTarget,
                    tsActive: false
                };
            }
        }
    } catch (e) {
        console.error(`[MAIN OBERVER] Erro ao processar ticker de ${symbol}: ${e.message}`);
    }
}
