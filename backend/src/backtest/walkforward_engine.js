import fs from 'fs';
import path from 'path';
import { loadHistoricalData } from '../data/historicalLoader.js';
import { simulateTrade } from '../execution/simulator.js';
import { calculateIndicators, loadStrategyConfig } from '../strategy/regime_engine.js';

/**
 * Walk-Forward Optimization Engine
 * Divides data into "In-Sample" (Training) and "Out-Of-Sample" (Testing) sliding windows.
 */

// Step days sizes
const TRAIN_DAYS = 30; // 30 days of training
const TEST_DAYS = 15;  // 15 days of validation ahead

function generateParameterGrid() {
    const grid = [];
    
    // Simplificado para varrer as estratégias propostas
    const vwapMultipliers = [1.0, 1.5, 2.0];
    const rsiCombinations = [{low: 30, high: 70}, {low: 25, high: 75}];
    const emaSets = [{fast: 30, slow: 150}, {fast: 50, slow: 200}];

    for (const vMult of vwapMultipliers) {
        for (const rsi of rsiCombinations) {
            for (const ema of emaSets) {
                grid.push({
                    vwapMultiplier: vMult,
                    rsiOversold: rsi.low,
                    rsiOverbought: rsi.high,
                    emaFast: ema.fast,
                    emaSlow: ema.slow,
                    tpRate: 0.06,  // keeping fix scaling to avoid combinatorial explosion here
                    slRate: 0.03
                });
            }
        }
    }
    
    return grid;
}

export async function runWalkForward(symbol, globalStartTime, globalEndTime) {
    console.log(`\n=== INICIANDO WALK-FORWARD OPTIMIZATION [${symbol}] ===`);
    console.log(`Período de Treino In-Sample: ${TRAIN_DAYS} dias`);
    console.log(`Período de Teste Out-Of-Sample: ${TEST_DAYS} dias\n`);

    const candles = await loadHistoricalData(symbol, '1m', globalStartTime, globalEndTime);
    if (!candles || candles.length < 1000) {
        return console.error("Dados insuficientes para Walk-Forward.");
    }

    const MINUTE_MS = 60000;
    const DAY_MS = MINUTE_MS * 60 * 24;

    const firstTs = candles[0].ts;
    const lastTs = candles[candles.length - 1].ts;

    let currentTrainStart = firstTs;
    const grid = generateParameterGrid();
    const configTemplate = loadStrategyConfig();
    
    const oosResults = [];
    
    // Pré-calculamos tudo da base completa pra acelerar, e usamos fatias em array
    console.log('Pré-calculando Regime Arrays gigantescos...');
    const allIndicators = calculateIndicators(candles);

    let windowId = 1;

    while (currentTrainStart + (TRAIN_DAYS * DAY_MS) + (TEST_DAYS * DAY_MS) <= lastTs) {
        const trainEnd = currentTrainStart + (TRAIN_DAYS * DAY_MS);
        const testEnd = trainEnd + (TEST_DAYS * DAY_MS);

        console.log(`\n--- Janela Walk-Forward #${windowId} ---`);
        console.log(`IN-SAMPLE: ${new Date(currentTrainStart).toISOString()} -> ${new Date(trainEnd).toISOString()}`);
        console.log(`OUT-OF-SAMPLE: ${new Date(trainEnd).toISOString()} -> ${new Date(testEnd).toISOString()}`);

        const trainIdxStart = candles.findIndex(c => c.ts >= currentTrainStart);
        const trainIdxEnd = candles.findIndex(c => c.ts >= trainEnd);
        const testIdxEnd = candles.findIndex(c => c.ts >= testEnd);

        // 1. Otimiza IN-SAMPLE
        let bestScore = -Infinity;
        let bestParams = null;

        for (const params of grid) {
            // Apply params to temp config
            const simConfig = JSON.parse(JSON.stringify(configTemplate));
            simConfig.vwapStrategy.atrThresholdMultiplier = params.vwapMultiplier;
            simConfig.vwapStrategy.rsiOversold = params.rsiOversold;
            simConfig.vwapStrategy.rsiOverbought = params.rsiOverbought;
            simConfig.trendStrategy.emaFast = params.emaFast;
            simConfig.trendStrategy.emaSlow = params.emaSlow;

            const res = runDatasetSimulation(candles, allIndicators, trainIdxStart, trainIdxEnd, simConfig);
            
            const profitFactor = res.grossLoss < 0 ? Math.abs(res.grossProfit / res.grossLoss) : 99;
            const score = profitFactor * 0.4 + (res.winRate * 0.2) - (res.maxDrawdown * 0.2); // Score composto proxy

            // Penalizar under-trading no training sample
            if (res.totalTrades < 10) continue; 

            if (score > bestScore) {
                bestScore = score;
                bestParams = params;
            }
        }

        if (!bestParams) {
             console.log(`Janela #${windowId} não encontrou parâmetros robustos em In-Sample. Pulando janela...`);
             currentTrainStart += (TEST_DAYS * DAY_MS);
             windowId++;
             continue;
        }

        console.log(`MELHOR PARAMETRO IN-SAMPLE ENCONTRADO: ${JSON.stringify(bestParams)} (Score Proxy: ${bestScore.toFixed(2)})`);
        
        // 2. Executa OUT-OF-SAMPLE
        console.log('Rodando validação Out-Of-Sample...');
        
        const testConfig = JSON.parse(JSON.stringify(configTemplate));
        testConfig.vwapStrategy.atrThresholdMultiplier = bestParams.vwapMultiplier;
        testConfig.vwapStrategy.rsiOversold = bestParams.rsiOversold;
        testConfig.vwapStrategy.rsiOverbought = bestParams.rsiOverbought;
        testConfig.trendStrategy.emaFast = bestParams.emaFast;
        testConfig.trendStrategy.emaSlow = bestParams.emaSlow;

        const oosRes = runDatasetSimulation(candles, allIndicators, trainIdxEnd, testIdxEnd, testConfig);

        oosRes.windowId = windowId;
        oosRes.params = bestParams;
        oosResults.push(oosRes);
        
        console.log(`Resultado Out-Of-Sample: Lucro Líquido: ${oosRes.netProfit.toFixed(2)} USDT | Drawdown: ${(oosRes.maxDrawdown*100).toFixed(1)}% | Win Rate: ${(oosRes.winRate*100).toFixed(1)}% | Trades: ${oosRes.totalTrades}`);

        // Desliza a janela para a proxima etapa Out Of Sample
        currentTrainStart += (TEST_DAYS * DAY_MS);
        windowId++;
    }

    // Geração Relatório Final WFO
    console.log(`\n\n=== RELATO FINAL WALK-FORWARD ===`);
    let totalScoreOOS = 0;
    let sumWinRate = 0;
    let sumDrawdown = 0;
    let sumTrades = 0;
    let sumProfit = 0;

    for (const res of oosResults) {
        sumWinRate += res.winRate;
        sumDrawdown += res.maxDrawdown;
        sumTrades += res.totalTrades;
        sumProfit += res.netProfit;
        const profitFactor = res.grossLoss < 0 ? Math.abs(res.grossProfit / res.grossLoss) : 99;
        totalScoreOOS += profitFactor;
    }

    const n = Math.max(oosResults.length, 1);
    const avgWinRate = sumWinRate / n;
    const avgDrawdown = sumDrawdown / n;
    const avgPF = totalScoreOOS / n;

    console.log(`PERFORMANCE GERAL FORA DA AMOSTRA (${oosResults.length} Janelas OOS):`);
    console.log(`Retorno Líquido Total Acumulado OOS: ${sumProfit.toFixed(2)} USDT`);
    console.log(`Média Win Rate OOS: ${(avgWinRate*100).toFixed(2)}%`);
    console.log(`Média de Drawdown OOS: ${(avgDrawdown*100).toFixed(2)}%`);
    console.log(`Profit Factor Médio OOS: ${avgPF.toFixed(2)}`);
    console.log(`Total de Operações Validadas: ${sumTrades}`);

    let robust = (avgPF > 1.3 && avgWinRate > 0.52 && avgDrawdown < 0.3) ? 'SIM ✅' : 'NÃO / NOT ROBUST ❌';
    console.log(`\nSTATUS DE ROBUSTEZ DA ESTRUTURA GLOBAL: ${robust}`);
    
    // Save report
    const logDir = path.join(process.cwd(), 'backtest_logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    const rpt = {
        summary: { robust, avgPF, avgWinRate, avgDrawdown, sumProfit, sumTrades },
        windows: oosResults
    };
    fs.writeFileSync(path.join(logDir, `walkforward_report_${timestamp}.json`), JSON.stringify(rpt, null, 2));
    
    console.log(`\nRelatório completo salvo em /backtest_logs/walkforward_report_${timestamp}.json\n`);
}

function runDatasetSimulation(candles, allIndicators, startIdx, endIdx, config) {
    let balance = 1000;
    let maxBalance = balance;
    let maxDrawdown = 0;
    let consecutiveWins = 0;
    
    let totalTrades = 0;
    let winningTrades = 0;
    let grossProfit = 0;
    let grossLoss = 0;

    for (let i = startIdx; i < endIdx; i++) {
        const ind = allIndicators[i];
        const prevInd = allIndicators[i - 1];

        const tradeResult = simulateTrade(candles[i], balance, 'BTCUSDT', ind, prevInd, config, candles, i, consecutiveWins, maxBalance);
        
        if (tradeResult) {
            totalTrades++;
            const pnl = parseFloat(tradeResult.pnl);

            if (pnl > 0) {
                winningTrades++;
                grossProfit += pnl;
                consecutiveWins++;
            } else {
                grossLoss += pnl; // Loss is stored as negative
                consecutiveWins = 0;
            }

            balance = tradeResult.newBalance;

            if (balance > maxBalance) maxBalance = balance;
            const dd = (maxBalance - balance) / maxBalance;
            if (dd > maxDrawdown) maxDrawdown = dd;

            if (tradeResult.candlesElapsed && tradeResult.candlesElapsed > 0) {
                i += (tradeResult.candlesElapsed - 1);
            }
            i += (config.general.cooldownMinutes || 30);
        }
    }

    return {
        netProfit: balance - 1000,
        maxDrawdown,
        totalTrades,
        winRate: totalTrades > 0 ? winningTrades / totalTrades : 0,
        grossProfit,
        grossLoss
    };
}
