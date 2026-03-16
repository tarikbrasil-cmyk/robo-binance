/**
 * Atualiza o progresso do backtest no console ou UI.
 */
export function updateUIBacktest(trades, balance) {
    if (typeof process.stdout.write === 'function') {
        process.stdout.write(`\r[SIMULAÇÃO] Trades: ${trades.length} | Saldo: ${balance.toFixed(2)} USDT`);
    } else {
        console.log(`Trades: ${trades.length} | Saldo: ${balance.toFixed(2)} USDT`);
    }
}
