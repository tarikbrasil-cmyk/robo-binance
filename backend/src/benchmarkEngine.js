import fs from 'fs';
import path from 'path';
import { runBacktestProgrammatic } from './backtestRunner.js';
import { Parser } from 'json2csv';
import { getStrategySnapshot, saveStrategySnapshot, displayStrategyPanel } from './utils/strategySnapshot.js';

const benchmarkPeriods = [
    { name: "Period_1", start: "2023-10-01", end: "2023-12-25" },
    { name: "Period_2", start: "2024-04-01", end: "2024-06-15" },
    { name: "Period_3", start: "2022-05-01", end: "2022-10-15" }
];

const benchmarkSymbols = [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "BNBUSDT"
];

export async function runAutomaticBenchmark(initialBalance = 1000) {
    const strategySnapshot = getStrategySnapshot();
    const snapshotId = strategySnapshot.strategyId;
    saveStrategySnapshot(strategySnapshot);
    displayStrategyPanel(strategySnapshot);

    console.log('\n========================================================');
    console.log('       INICIANDO BENCHMARK AUTOMÁTICO');
    console.log('========================================================');
    console.log(`Períodos: ${benchmarkPeriods.length} | Moedas: ${benchmarkSymbols.length}`);
    console.log(`Total de testes: ${benchmarkPeriods.length * benchmarkSymbols.length}`);
    console.log('========================================================\n');

    const benchmarkResults = [];

    for (let pIdx = 0; pIdx < benchmarkPeriods.length; pIdx++) {
        const period = benchmarkPeriods[pIdx];
        console.log(`\n[Period ${pIdx + 1}/${benchmarkPeriods.length}] ${period.name}: ${period.start} -> ${period.end}`);

        for (let sIdx = 0; sIdx < benchmarkSymbols.length; sIdx++) {
            const symbol = benchmarkSymbols[sIdx];
            console.log(`  (${sIdx + 1}/${benchmarkSymbols.length}) Rodando: ${symbol}...`);

            try {
                // Transparency Mode: Override drawdown stop for benchmark to see full performance
                const benchmarkConfig = { ...strategySnapshot };
                benchmarkConfig.general = { ...benchmarkConfig.general, maxDrawdownStop: 0.99 };

                const result = await runBacktestProgrammatic(symbol, period.start, period.end, initialBalance, benchmarkConfig);
                
                if (result && result.summary) {
                    const pnlPercent = ((result.finalBalance - initialBalance) / initialBalance * 100).toFixed(2) + '%';
                    
                    benchmarkResults.push({
                        symbol,
                        periodName: period.name,
                        startDate: period.start,
                        endDate: period.end,
                        trades: result.summary.trades,
                        winRate: result.summary.winRate,
                        profitFactor: result.summary.profitFactor,
                        expectancy: result.summary.expectancy,
                        sharpeRatio: result.summary.sharpeRatio,
                        finalBalance: result.summary.finalBalance + ' USDT',
                        pnlPercent,
                        maxDrawdown: result.summary.maxDrawdown,
                        strategyId: snapshotId
                    });
                } else {
                    console.warn(`  [!] Sem resultados para ${symbol} no ${period.name}`);
                }
            } catch (error) {
                console.error(`  [ERROR] Falha no backtest ${symbol}/${period.name}:`, error.message);
            }
        }
    }

    displayBenchmarkReport(benchmarkResults);
    exportBenchmarkResults(benchmarkResults);
}

function displayBenchmarkReport(results) {
    console.log('\n========================================================');
    console.log('              BENCHMARK RESULTADOS');
    console.log('========================================================');
    console.log('Symbol'.padEnd(10) + 'Period'.padEnd(12) + 'Trades'.padEnd(8) + 'WinRate'.padEnd(10) + 'FinalBalance'.padEnd(15) + 'PnL%');
    console.log('-'.repeat(65));

    results.forEach(res => {
        console.log(
            res.symbol.padEnd(10) + 
            res.periodName.padEnd(12) + 
            res.trades.toString().padEnd(8) + 
            res.winRate.padEnd(10) + 
            res.finalBalance.padEnd(15) + 
            res.pnlPercent
        );
    });

    console.log('\n==============================');
    console.log('       RESUMO POR MOEDA');
    console.log('==============================');

    const symbols = [...new Set(results.map(r => r.symbol))];
    symbols.forEach(sym => {
        const symResults = results.filter(r => r.symbol === sym);
        if (symResults.length === 0) return;

        const avgPnL = symResults.reduce((acc, r) => acc + parseFloat(r.pnlPercent), 0) / symResults.length;
        const avgTrades = symResults.reduce((acc, r) => acc + r.trades, 0) / symResults.length;

        console.log(`\n${sym}`);
        console.log(`Average PnL: ${avgPnL.toFixed(2)}%`);
        console.log(`Average Trades: ${avgTrades.toFixed(1)}`);
    });
    console.log('==============================\n');
}

function exportBenchmarkResults(results) {
    const logDir = path.join(process.cwd(), 'backtest_logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = path.join(logDir, `benchmark_results_${timestamp}.json`);
    const csvPath = path.join(logDir, `benchmark_results_${timestamp}.csv`);

    // Resumo para o JSON
    const summary = {};
    const symbols = [...new Set(results.map(r => r.symbol))];
    symbols.forEach(sym => {
        const symResults = results.filter(r => r.symbol === sym);
        summary[sym] = {
            avgPnL: (symResults.reduce((acc, r) => acc + parseFloat(r.pnlPercent), 0) / symResults.length).toFixed(2) + '%',
            avgTrades: (symResults.reduce((acc, r) => acc + r.trades, 0) / symResults.length).toFixed(1),
            totalTrades: symResults.reduce((acc, r) => acc + r.trades, 0)
        };
    });

    const exportData = {
        periods: benchmarkPeriods,
        symbols: benchmarkSymbols,
        results,
        summary
    };

    try {
        // JSON Export
        fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2));
        
        // CSV Export
        if (results.length > 0) {
            const parser = new Parser({ 
                fields: [
                    'symbol', 'periodName', 'startDate', 'endDate', 
                    'trades', 'winRate', 'profitFactor', 'finalBalance', 
                    'pnlPercent', 'maxDrawdown', 'strategyId'
                ] 
            });
            const csv = parser.parse(results);
            fs.writeFileSync(csvPath, csv);
        }

        console.log(`[Benchmark] Relatórios exportados com sucesso:`);
        console.log(`  JSON: ${jsonPath}`);
        console.log(`  CSV : ${csvPath}`);
    } catch (error) {
        console.error('[Benchmark] Erro ao exportar relatórios:', error.message);
    }
}
