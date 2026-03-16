import { startBacktestMenu } from './src/backtestRunner.js';

// Iniciando o menu de backtest
startBacktestMenu().catch(err => {
    console.error('Falha ao iniciar o menu de backtest:', err);
    process.exit(1);
});
