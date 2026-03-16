/**
 * Exchange Client Factory
 * Seleciona o cliente CCXT correto baseado em BOT_MODE do .env
 */
import dotenv from 'dotenv';
dotenv.config();

const envMode = (process.env.BOT_MODE || 'FUTURES').trim().toUpperCase();
export const BOT_MODE = envMode === 'SPOT' ? 'SPOT' : 'FUTURES';
export const IS_SPOT = BOT_MODE === 'SPOT';
export const IS_FUTURES = BOT_MODE === 'FUTURES';

let exchangeClient;

if (IS_SPOT) {
    const { default: binanceSpot } = await import('./binanceSpot.js');
    exchangeClient = binanceSpot;
    console.log('🟦 BOT_MODE: SPOT — usando cliente binance (spot)');
} else {
    const { default: binanceFutures } = await import('./binance.js');
    exchangeClient = binanceFutures;
    console.log('🟨 BOT_MODE: FUTURES — usando cliente binanceusdm (futuros)');
}

/**
 * Helper unificado para buscar saldo
 */
export async function getUnifiedBalance() {
    try {
        const balanceInfo = await exchangeClient.fetchBalance();
        if (IS_SPOT) {
            return balanceInfo.free?.USDT || 0;
        } else {
            return balanceInfo.total?.USDT || 0;
        }
    } catch (e) {
        console.error('Erro ao buscar saldo unificado:', e.message);
        return 0;
    }
}

export default exchangeClient;
