import exchange, { BOT_MODE, IS_SPOT } from '../services/exchangeClient.js';

async function testConnection() {
    console.log(`🧪 Testando Conexão - MODO: ${BOT_MODE}`);
    try {
        await exchange.loadMarkets();
        console.log('✅ Mercados carregados com sucesso.');
        
        const balance = await exchange.fetchBalance();
        const usdt = IS_SPOT ? balance.free?.USDT : balance.total?.USDT;
        
        console.log(`✅ Conexão Binance OK! Saldo USDT: ${usdt || 0}`);
        process.exit(0);
    } catch (e) {
        console.error(`❌ Erro de conexão Binance: ${e.message}`);
        process.exit(1);
    }
}

testConnection();
