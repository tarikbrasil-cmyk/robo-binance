import ccxt from 'ccxt';
import dotenv from 'dotenv';
dotenv.config();

// Cliente CCXT para SPOT trading (ccxt.binance = spot, não futuros)
const binanceSpot = new ccxt.binance({
    apiKey: (process.env.BINANCE_API_KEY || '').trim(),
    secret: (process.env.BINANCE_API_SECRET || '').trim(),
    enableRateLimit: true,
    options: {
        defaultType: 'spot',
    }
});

// Demo Trading para spot (usa a conta demo spot da Binance)
if (process.env.BINANCE_TESTNET === 'true') {
    binanceSpot.enableDemoTrading(true);
    console.log('⚠️  Binance SPOT executando em modo DEMO TRADING');
}

/**
 * Retorna saldo disponível em USDT da conta SPOT
 */
export async function getSpotWalletBalance() {
    try {
        const balance = await binanceSpot.fetchBalance();
        return balance.free.USDT || 0;
    } catch (error) {
        console.error('Erro ao buscar saldo SPOT:', error.message);
        throw error;
    }
}

export default binanceSpot;
