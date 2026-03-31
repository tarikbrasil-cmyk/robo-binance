import fs from 'fs';
import path from 'path';
import { runOptimizationSearch } from './src/optimization/OptimizationEngine.js';
import { loadStrategyConfig } from './src/strategy/regime_engine.js';

async function main() {
    const baseConfig = loadStrategyConfig();
    
    const searchSpace = {
        symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
        timeframes: ['5m', '15m', '1h'],
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
    console.log('Regras: Min 30 trades | WR > 55% | PF > 1.3 | Período: 3 Meses');
    console.log(`Symbols: ${searchSpace.symbols.join(', ')}  |  Timeframes: ${searchSpace.timeframes.join(', ')}`);
    
    try {
        const topResults = await runOptimizationSearch(baseConfig, searchSpace);
        
        console.log('\n=========================================');
        console.log('TOP PERFORMANCE CANDIDATES (FOUND):');
        console.log('=========================================');
        
        if (topResults.length === 0) {
            console.log('Nenhuma configuração atingiu os critérios mínimos.');
        } else {
            // Filter: require ≥ 30 trades (belt-and-suspenders; OptimizationEngine may already filter)
            const qualified = topResults.filter(r => (r.metrics?.tradesCount ?? 0) >= 30);

            // Composite score: WR * 0.5 + (PF/5) * 0.3 - maxDrawdown * 0.2
            const scored = qualified.map(r => ({
                ...r,
                compositeScore: (
                    (r.metrics.winRate / 100) * 0.5 +
                    Math.min(r.metrics.profitFactor / 5, 1) * 0.3 -
                    ((r.metrics.maxDrawdown ?? 0) / 100) * 0.2
                ),
            })).sort((a, b) => b.compositeScore - a.compositeScore);

            const top50 = scored.slice(0, 50);
            console.log(`\n${top50.length} candidatos qualificados (de ${topResults.length} testados):\n`);

            top50.forEach((res, i) => {
                console.log(`RANK #${i+1}: ${res.symbol} @ ${res.tf}  Score=${res.compositeScore.toFixed(3)}`);
                console.log(`  WR ${res.metrics.winRate}% | PF ${res.metrics.profitFactor.toFixed(2)} | Trades ${res.metrics.tradesCount} | DD ${(res.metrics.maxDrawdown??0).toFixed(1)}%`);
                console.log(`  EMA ${res.params.emaFastPeriod}/${res.params.emaSlowPeriod} | RSI ${res.params.rsiOversold}/${res.params.rsiOverbought} | SL ${res.params.atrMultiplier}x | TP ${res.params.tpMultiplier}x | ${res.params.session}`);
            });

            // Save to JSON for later analysis
            fs.writeFileSync('optimization_top_results.json', JSON.stringify(top50, null, 2));
            console.log(`\n💾 Resultados salvos em optimization_top_results.json`);
        }
    } catch (error) {
        console.error('Optimization failed:', error);
    }
}

main();
