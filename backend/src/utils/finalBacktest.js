import { startBacktestMenu } from '../backtestRunner.js';
import { loadHistoricalData } from '../data/historicalLoader.js';
import { simulateTrade } from '../execution/simulator.js';
import { logBacktestResult } from './backtestLogger.js';
import path from 'path';
import fs from 'fs';

async function runFinalBacktest() {
    const symbol = 'BTCUSDT';
    const now = Date.now();
    const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);
    const balance = 1000;

    console.log(`\n=== EXECUTANDO BACKTEST FINAL VALIDADO [${symbol}] ===`);
    
    // 1. Carregar Dados Reais
    const candles = await loadHistoricalData(symbol, '1m', oneWeekAgo, now);
    if (!candles || candles.length === 0) return console.error('Sem dados.');

    const closes = candles.map(c => c.close);
    
    // Indicadores ( technicalindicators precisa dos dados completos)
    // Usando os mesmos períodos do runner original
    const { RSI, EMA } = await import('technicalindicators');
    const rsiData = RSI.calculate({ values: closes, period: 14 });
    const ema9Data = EMA.calculate({ values: closes, period: 9 });
    const ema21Data = EMA.calculate({ values: closes, period: 21 });

    const offsetRSI = closes.length - rsiData.length;
    const offsetEMA9 = closes.length - ema9Data.length;
    const offsetEMA21 = closes.length - ema21Data.length;
    const startIdx = Math.max(offsetRSI, offsetEMA9, offsetEMA21) + 1;

    let trades = [];
    let currentBalance = balance;
    let lastTradeTime = 0;

    for (let i = startIdx; i < candles.length; i++) {
        if (candles[i].ts <= lastTradeTime) continue;

        const context = {
            rsi: rsiData[i - offsetRSI],
            emaFast: ema9Data[i - offsetEMA9],
            emaSlow: ema21Data[i - offsetEMA21],
            prevEmaFast: ema9Data[i - 1 - offsetEMA9],
            prevEmaSlow: ema21Data[i - 1 - offsetEMA21]
        };

        const result = simulateTrade(candles[i], currentBalance, symbol, context, {}, candles, i);
        
        if (result) {
            trades.push(result);
            currentBalance = result.newBalance;
            lastTradeTime = result.exitTime;
        }
    }

    console.log(`\nBacktest Finalizado.`);
    console.log(`Trades: ${trades.length}`);
    console.log(`Saldo Final: ${currentBalance.toFixed(2)} USDT`);

    // Salvar Logs
    const logDir = path.join(process.cwd(), 'backtest_logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFileCSV = path.join(logDir, `${symbol}_FINAL_VALIDADO_${timestamp}.csv`);
    const logFileJSON = path.join(logDir, `${symbol}_FINAL_VALIDADO_${timestamp}.json`);

    logBacktestResult(trades, logFileCSV, logFileJSON);
    console.log(`\nLOGS GERADOS:\nCSV: ${logFileCSV}\nJSON: ${logFileJSON}`);
}

runFinalBacktest();
