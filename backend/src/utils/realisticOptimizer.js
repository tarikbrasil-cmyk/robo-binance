import fs from 'fs';
import path from 'path';
import { RSI, EMA } from 'technicalindicators';
import { simulateTrade } from '../execution/simulator.js';
import { loadHistoricalData } from '../data/historicalLoader.js';

/**
 * Realistic Optimizer: Busca os melhores parâmetros usando validação real candle-a-candle.
 */
async function runRealisticOptimization(symbol, startTime, endTime) {
    console.log(`\n=== INICIANDO OTIMIZAÇÃO REALISTA [${symbol}] ===`);
    
    // 1. Carregar Dados Reais
    const candles = await loadHistoricalData(symbol, '1m', startTime, endTime);
    if (!candles || candles.length < 500) {
        return console.error('Dados insuficientes para otimização realista.');
    }

    const closes = candles.map(c => c.close);
    
    // 2. Pre-calculo de Indicadores Base
    console.log('Pre-calculando indicadores...');
    const rsiData = RSI.calculate({ values: closes, period: 14 });
    const ema9Data = EMA.calculate({ values: closes, period: 9 });
    const ema21Data = EMA.calculate({ values: closes, period: 21 });

    const offsetRSI = closes.length - rsiData.length;
    const offsetEMA9 = closes.length - ema9Data.length;
    const offsetEMA21 = closes.length - ema21Data.length;
    const startIdx = Math.max(offsetRSI, offsetEMA9, offsetEMA21) + 1;

    // 3. Grid Search Space (Expandido)
    const scenarios = [];
    const rsiLowLevels = [25, 30, 35];
    const rsiHighLevels = [65, 70, 75];
    const tpLevels = [0.03, 0.05, 0.08];
    const slLevels = [0.02, 0.03];
    const leverageLevels = [10, 20];
    const filters = [{ useEmaFilter: true }, { useEmaFilter: false }];

    for (const filterConfig of filters) {
        for (const rsiLow of rsiLowLevels) {
            for (const rsiHigh of rsiHighLevels) {
                for (const tp of tpLevels) {
                    for (const sl of slLevels) {
                        for (const lev of leverageLevels) {
                            scenarios.push({
                                config: { 
                                    type: 'RSI_ONLY', 
                                    rsiLow, 
                                    rsiHigh, 
                                    takeProfit: tp, 
                                    stopLoss: sl, 
                                    leverage: lev,
                                    ...filterConfig 
                                },
                                results: { profit: 0, trades: 0, wins: 0, losses: 0, maxDrawdown: 0 }
                            });
                        }
                    }
                }
            }
        }
    }

    console.log(`Testando ${scenarios.length} variantes em ${candles.length} candles (Real Pathing)...`);

    // 4. Loop de Simulação
    for (let scenario of scenarios) {
        let balance = 1000;
        let maxBalance = 1000;
        let maxDrawdown = 0;
        let lastTradeTime = 0;

        for (let i = startIdx; i < candles.length; i++) {
            // Impedir múltiplos trades simultâneos (esperar o candle de saída)
            if (candles[i].ts <= lastTradeTime) continue;

            const context = {
                rsi: rsiData[i - offsetRSI],
                emaFast: ema9Data[i - offsetEMA9],
                emaSlow: ema21Data[i - offsetEMA21],
                prevEmaFast: ema9Data[i - 1 - offsetEMA9],
                prevEmaSlow: ema21Data[i - 1 - offsetEMA21]
            };
            
            // Injeta a lista completa de candles para validação real no simulador
            const res = simulateTrade(candles[i], balance, symbol, context, scenario.config, candles, i);
            
            if (res) {
                scenario.results.trades++;
                const pnl = parseFloat(res.pnl);
                if (pnl > 0) scenario.results.wins++;
                else scenario.results.losses++;
                
                balance = res.newBalance;
                lastTradeTime = res.exitTime; // Avança o tempo até o fechamento do trade
                
                if (balance > maxBalance) maxBalance = balance;
                const dd = (maxBalance - balance) / maxBalance;
                if (dd > maxDrawdown) maxDrawdown = dd;
                
                if (balance <= 0) break; // Quebrou a banca
            }
        }

        scenario.results.profit = balance - 1000;
        scenario.results.winRate = (scenario.results.wins / scenario.results.trades) * 100 || 0;
        scenario.results.maxDrawdown = maxDrawdown * 100;
        
        // Score: Lucro Ajustado pelo Risco (Drawdown)
        scenario.score = scenario.results.profit - (maxDrawdown * 1000);
        if (scenario.results.trades < 5) scenario.score = -Infinity; // Requer amostragem mínima
    }

    // 5. Comparação e Resultado
    scenarios.sort((a, b) => b.score - a.score);
    const best = scenarios[0];

    console.log('\n--- TOP 5 VARIANTES REALISTAS ---');
    console.table(scenarios.slice(0, 5).map(s => ({
        Profit: s.results.profit.toFixed(2),
        Trades: s.results.trades,
        'Win Rate': s.results.winRate.toFixed(1) + '%',
        'Max DD': s.results.maxDrawdown.toFixed(1) + '%',
        Config: `${s.config.type} | RSI:${s.config.rsiLow}-${s.config.rsiHigh} | TP:${s.config.takeProfit} | SL:${s.config.stopLoss} | x${s.config.leverage}`
    })));

    if (best && best.results.trades > 0) {
        console.log(`\nMelhor Configuração Realista:`);
        console.log(JSON.stringify(best.config, null, 2));
        
        // 6. Atualização Automática do Script (Simulação de injeção)
        updateSimulatorConfig(best.config);
    }
    
    return best;
}

function updateSimulatorConfig(config) {
    const simulatorPath = path.join(process.cwd(), 'src', 'execution', 'simulator.js');
    console.log(`\n[AUTO] Atualizando ${simulatorPath} com novos parâmetros...`);
    
    try {
        let content = fs.readFileSync(simulatorPath, 'utf8');
        
        // Regex para encontrar o objeto settings dentro de simulateTrade
        const settingsRegex = /const settings = \{[\s\S]*?(\.\.\.config\n\s+\};)/;
        const newSettings = `const settings = {
        type: '${config.type}', 
        rsiLow: ${config.rsiLow},
        rsiHigh: ${config.rsiHigh},
        takeProfit: ${config.takeProfit},
        stopLoss: ${config.stopLoss},
        leverage: ${config.leverage},
        useEmaFilter: ${config.useEmaFilter},
        useVolFilter: ${config.useVolFilter || false},
        ...config
    };`;
        
        const updatedContent = content.replace(settingsRegex, newSettings);
        fs.writeFileSync(simulatorPath, updatedContent);
        console.log('Parâmetros injetados com sucesso.');
    } catch (err) {
        console.error('Erro ao atualizar simulator.js:', err.message);
    }
}

// Execução se chamado via CLI
const now = Date.now();
const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);
runRealisticOptimization('BTCUSDT', oneWeekAgo, now);

export { runRealisticOptimization };
