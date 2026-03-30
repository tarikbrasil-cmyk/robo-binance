import fs from 'fs';
import path from 'path';
import { runOptimizationSearch } from './src/optimization/OptimizationEngine.js';
import { loadStrategyConfig } from './src/strategy/regime_engine.js';

async function main() {
    const baseConfig = loadStrategyConfig();
    
    const searchSpace = {
        symbols: ['BTCUSDT', 'ETHUSDT'],
        timeframes: ['5m', '15m'],
        params: {
            rsiPeriod: [14],
            rsiOversold: [35, 45],
            rsiOverbought: [55, 65],
            emaFastPeriod: [20, 50],
            emaSlowPeriod: [100, 200],
            emaHTFPeriod: [1000],
            useEmaHTF: [false], // HTF EMA was too restrictive
            atrMultiplier: [2.5, 3.5], // Wider SL for WR
            tpMultiplier: [1.5, 3.0], // Tighter TP for WR
            session: ['NY', 'LONDON'],
            useBreakout: [true, false],
            useMeanReversion: [true, false],
            useSessionFilter: [true]
        }
    };

    console.log('Starting Massive Optimization Benchmark...');
    console.log('Regras: Win Rate > 55%, PF > 1.3, Trades > 100, Período: 3 Meses');
    
    try {
        const topResults = await runOptimizationSearch(baseConfig, searchSpace);
        
        console.log('\n=========================================');
        console.log('TOP PERFORMANCE CANDIDATES (FOUND):');
        console.log('=========================================');
        
        if (topResults.length === 0) {
            console.log('Nenhuma configuração atingiu os critérios mínimos (WR > 55%).');
        } else {
            topResults.forEach((res, i) => {
                console.log(`\nRANK #${i+1}: ${res.symbol} @ ${res.tf}`);
                console.log(`Metrics: WR ${res.metrics.winRate} | PF ${res.metrics.profitFactor.toFixed(2)} | Trades ${res.metrics.tradesCount}`);
                console.log(`Params: RSI ${res.params.rsiPeriod}, EMA ${res.params.emaFastPeriod}/${res.params.emaSlowPeriod}, SL ${res.params.atrMultiplier}x ATR`);
            });
            
            // Save to JSON for later analysis
            fs.writeFileSync('optimization_top_results.json', JSON.stringify(topResults, null, 2));
        }
    } catch (error) {
        console.error('Optimization failed:', error);
    }
}

main();
