import ccxt from 'ccxt';
import dotenv from 'dotenv';
dotenv.config();

async function diagnose() {
    const rawMode = process.env.BOT_MODE || 'NOT_SET';
    const rawApiKey = process.env.BINANCE_API_KEY || 'NOT_SET';
    const rawSecret = process.env.BINANCE_API_SECRET || 'NOT_SET';
    const isTestnet = process.env.BINANCE_TESTNET === 'true';

    console.log('--- Diagnostics ---');
    console.log(`BOT_MODE: "${rawMode}" (length: ${rawMode.length})`);
    console.log(`BINANCE_TESTNET: ${isTestnet}`);
    console.log(`API_KEY: "${rawApiKey.substring(0, 4)}...${rawApiKey.substring(rawApiKey.length - 4)}" (length: ${rawApiKey.length})`);
    
    const botMode = rawMode.trim().toUpperCase();
    const isSpot = botMode === 'SPOT';

    console.log(`Effective Mode: ${botMode} (IS_SPOT: ${isSpot})`);

    const client = isSpot ? new ccxt.binance() : new ccxt.binanceusdm();
    client.apiKey = rawApiKey.trim();
    client.secret = rawSecret.trim();
    
    if (isTestnet) {
        client.enableDemoTrading(true); 
        console.log(`Environment: ${isSpot ? 'SPOT' : 'FUTURES'} DEMO TRADING`);
    }

    try {
        console.log('Testing fetchBalance()...');
        const balance = await client.fetchBalance();
        console.log('✅ Authentication SUCCESS!');
        if (isSpot) {
            console.log(`Balance: ${balance.free.USDT} USDT`);
        } else {
            console.log(`Balance: ${balance.total.USDT} USDT`);
        }
    } catch (e) {
        console.error('❌ Authentication FAILED!');
        console.error(`Error: ${e.message}`);
        
        if (e.message.includes('-2015')) {
            console.log('\nHINT: Error -2015 usually means:');
            console.log('1. Trailing spaces in API_KEY or API_SECRET in .env file.');
            console.log('2. Using Testnet (testnet.binance.vision) keys on Demo Trading (demo-fapi.binance.com) or vice versa.');
            console.log('3. API Key is missing "Enable Futures" permission (if using mainnet).');
            console.log('4. API Key is invalid or expired.');
        }
    }
}

diagnose();
