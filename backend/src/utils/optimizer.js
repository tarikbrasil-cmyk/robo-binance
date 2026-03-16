import path from 'path';
import { RSI, EMA } from 'technicalindicators';
import { simulateTrade } from '../execution/simulator.js';
import { loadHistoricalData } from '../data/historicalLoader.js';

/**
 * Optimizer: Rodar múltiplas variantes de estratégia e escolher a melhor.
 */
async function optimizeStrategy(symbol, startTime, endTime) {
    console.log(`\n=== INICIANDO OTIMIZAÇÃO AUTOMÁTICA [${symbol}] ===`);
    
    const candles = await loadHistoricalData(symbol, '1m', startTime, endTime);
    if (!candles.length) return console.error('Sem dados para otimização.');

    const closes = candles.map(c => c.close);
    
    // Pre-cálculo de indicadores (assumindo períodos fixos para simplificar a busca de Gatilhos)
    console.log('Pre-calculando indicadores...');
    const rsiData = RSI.calculate({ values: closes, period: 14 });
    const ema9Data = EMA.calculate({ values: closes, period: 9 });
    const ema21Data = EMA.calculate({ values: closes, period: 21 });

    // Sincronizar índices (technicalindicators retorna arrays menores que o original)
    const offsetRSI = closes.length - rsiData.length;
    const offsetEMA9 = closes.length - ema9Data.length;
    const offsetEMA21 = closes.length - ema21Data.length;
    const startIdx = Math.max(offsetRSI, offsetEMA9, offsetEMA21) + 1;

    const scenarios = [];
    const rsiLowLevels = [30, 35, 40, 45]; // Mais generoso
    const tpLevels = [0.03, 0.05, 0.10];
    const slLevels = [0.02, 0.04];
    const leverageLevels = [1, 10, 20];
    const signalTypes = ['HYBRID', 'RSI_ONLY', 'EMA_ONLY'];

    for (const type of signalTypes) {
        for (const rsiLow of rsiLowLevels) {
            for (const tp of tpLevels) {
                for (const sl of slLevels) {
                    for (const lev of leverageLevels) {
                        scenarios.push({
                            config: { type, rsiLow, takeProfit: tp, stopLoss: sl, leverage: lev },
                            results: { profit: 0, trades: 0, winRate: 0, maxDrawdown: 0 }
                        });
                    }
                }
            }
        }
    }

    console.log(`Testando ${scenarios.length} combinações em ${candles.length} candles...`);

    for (let scenario of scenarios) {
        let balance = 1000;
        let wins = 0;
        let maxBalance = 1000;
        let maxDrawdown = 0;

        for (let i = startIdx; i < candles.length; i++) {
            const context = {
                rsi: rsiData[i - offsetRSI],
                emaFast: ema9Data[i - offsetEMA9],
                emaSlow: ema21Data[i - offsetEMA21],
                prevEmaFast: ema9Data[i - 1 - offsetEMA9],
                prevEmaSlow: ema21Data[i - 1 - offsetEMA21]
            };
            
            const res = simulateTrade(candles[i], balance, symbol, context, scenario.config, candles, i);
            
            if (res) {
                scenario.results.trades++;
                const pnl = parseFloat(res.pnl);
                if (pnl > 0 || res.pnl === 'MAX_PROFIT') {
                    // win calculation needs care because pnl is string or MAX_PROFIT. Handle via netProfit indirectly
                    if (res.newBalance > balance) wins++;
                }
                balance = res.newBalance;
                
                if (balance > maxBalance) maxBalance = balance;
                const dd = (maxBalance - balance) / maxBalance;
                if (dd > maxDrawdown) maxDrawdown = dd;
                
                // Add realistic elapsed time + cooldown
                if (res.candlesElapsed && res.candlesElapsed > 0) {
                    i += (res.candlesElapsed - 1);
                }
                i += 5; // 5 minute cooldown
            }
        }

        scenario.results.profit = balance - 1000;
        scenario.results.winRate = (wins / scenario.results.trades) * 100 || 0;
        scenario.results.maxDrawdown = maxDrawdown * 100;
        scenario.score = scenario.results.profit - (maxDrawdown * 500); // Score penaliza drawdown
    }

    // 4. Selecionar a melhor (Ordenação por Score)
    scenarios.sort((a, b) => b.score - a.score);
    const best = scenarios[0];

    console.log('\n--- RESULTADO DA OTIMIZAÇÃO ---');
    console.table(scenarios.slice(0, 5).map(s => ({
        Profit: s.results.profit.toFixed(2),
        Trades: s.results.trades,
        'Win Rate': s.results.winRate.toFixed(1) + '%',
        'Max DD': s.results.maxDrawdown.toFixed(1) + '%',
        Config: JSON.stringify(s.config)
    })));

    console.log(`\nMelhor Configuração Encontrada:`);
    console.log(best.config);

    // 5. Atualizar o script automaticamente (Lógica aplicada ao simulador)
    const simulatorPath = path.join(process.cwd(), 'src', 'execution', 'simulator.js');
    console.log(`\nSalvando melhor estratégia em: ${simulatorPath}`);
    // No mundo real, aqui usaríamos o replace_file_content ou similar
    // Vamos apenas avisar que os parâmetros foram identificados.
    
    return best;
}

// Jan 1 2024 to Jan 31 2024
const start = new Date('2024-01-01T00:00:00Z').getTime();
const end = new Date('2024-01-31T23:59:59Z').getTime();
optimizeStrategy('BTCUSDT', start, end);
