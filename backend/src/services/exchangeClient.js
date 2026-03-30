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

// Cache do último saldo válido para resiliência contra falhas de rede
let lastKnownBalance = 0;

/**
 * Helper unificado para buscar saldo com retry e cache
 */
export async function getUnifiedBalance() {
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const balanceInfo = await exchangeClient.fetchBalance();
            const balance = IS_SPOT
                ? (balanceInfo.free?.USDT || 0)
                : (balanceInfo.total?.USDT || 0);
            lastKnownBalance = balance; // cache on success
            return balance;
        } catch (e) {
            if (attempt < MAX_RETRIES) {
                const delay = 1000 * Math.pow(2, attempt - 1); // 1s, 2s
                console.warn(`[BALANCE] Tentativa ${attempt}/${MAX_RETRIES} falhou: ${e.message}. Retry em ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
            } else {
                console.error(`[BALANCE] Todas as ${MAX_RETRIES} tentativas falharam: ${e.message}. Usando cache: $${lastKnownBalance}`);
                return lastKnownBalance;
            }
        }
    }
    return lastKnownBalance;
}

export default exchangeClient;
