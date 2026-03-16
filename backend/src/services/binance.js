import ccxt from 'ccxt';
import dotenv from 'dotenv';
dotenv.config();

// Create the binance futures client
const binance = new ccxt.binanceusdm({
    apiKey: (process.env.BINANCE_API_KEY || '').trim(),
    secret: (process.env.BINANCE_API_SECRET || '').trim(),
    enableRateLimit: true,
    options: {
        defaultType: 'future', 
    }
});

// Use Demo Trading if defined (antigo testnet/sandbox descontinuado pela Binance em 2025)
// REST:      https://demo-fapi.binance.com  (configurado automaticamente pelo enableDemoTrading)
// WebSocket: wss://fstream.binancefuture.com (configurado em binanceWs.js)
// Chaves geradas em: Binance > Futures > Demo Trading > API Management
if (process.env.BINANCE_TESTNET === 'true') {
    binance.enableDemoTrading(true);
    console.log('⚠️  Binance executando em modo DEMO TRADING');
    console.log('    REST : https://demo-fapi.binance.com');
    console.log('    WS   : wss://fstream.binancefuture.com');
}

/**
 * Valida a conexão com a exchange retornando o saldo
 */
export async function getWalletBalance() {
    try {
        const balance = await binance.fetchBalance();
        return balance.total.USDT || 0;
    } catch (error) {
        console.error('Erro ao buscar saldo:', error.message);
        throw error;
    }
}

export default binance;
