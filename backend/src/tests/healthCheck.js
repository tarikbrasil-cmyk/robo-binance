import exchange, { BOT_MODE, IS_SPOT } from '../services/exchangeClient.js';

/**
 * Health Check - Verifies API connectivity and permissions
 */
async function runHealthCheck() {
    console.log(`\n🔍 INICIANDO HEALTH CHECK: [ MODO: ${BOT_MODE} ]`);
    console.log('================================================');

    try {
        // 1. Check Connectivity & Balance
        console.log('1. Verificando conectividade e saldo...');
        const balance = await exchange.fetchBalance();
        const available = IS_SPOT ? (balance.free?.USDT || 0) : (balance.total?.USDT || 0);
        console.log(`✅ Conectado! Saldo disponível: ${available} USDT`);

        // 2. Check Permissions (Load Markets)
        console.log('\n2. Verificando permissões de mercado...');
        await exchange.loadMarkets();
        console.log('✅ Mercados carregados com sucesso.');

        // 3. Test API specific methods based on mode
        if (IS_SPOT) {
            console.log('\n3. Verificando métodos SPOT...');
            // Fetch some recent trades to see if we can read market data
            await exchange.fetchTrades('BTC/USDT');
            console.log('✅ Leitura de Trades SPOT OK.');
        } else {
            console.log('\n3. Verificando métodos FUTURES...');
            await exchange.fetchPositions();
            console.log('✅ Leitura de Posições FUTURES OK.');
        }

        console.log('\n================================================');
        console.log('🚀 SYSTEM STATUS: READY');
    } catch (error) {
        console.error('\n❌ ERRO NO HEALTH CHECK:');
        console.error(`Mensagem: ${error.message}`);
        if (error.message.includes('API key')) {
            console.error('DICA: Verifique se as chaves de API no .env estão corretas e se o modo (Testnet/Real) coincide.');
        }
        process.exit(1);
    }
}

runHealthCheck();
