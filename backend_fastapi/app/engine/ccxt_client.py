import ccxt
import os
from dotenv import load_dotenv

load_dotenv()

class ExchangeClient:
    def __init__(self, api_key=None, secret=None, mode="FUTURES", testnet=True):
        self.mode = mode.upper()
        self.testnet = testnet
        
        exchange_id = 'binance' if self.mode == 'SPOT' else 'binanceusdm'
        
        self.client = getattr(ccxt, exchange_id)({
            'apiKey': api_key or os.getenv("BINANCE_API_KEY"),
            'secret': secret or os.getenv("BINANCE_API_SECRET"),
            'enableRateLimit': True,
            'options': {
                'defaultType': 'spot' if self.mode == 'SPOT' else 'future',
            }
        })
        
        if self.testnet:
            self.client.set_sandbox_mode(True)
            print(f"⚠️ Exchange {exchange_id} in SANDBOX mode")

    async def fetch_balance(self):
        balance = await self.client.fetch_balance()
        if self.mode == 'SPOT':
            return balance['free'].get('USDT', 0)
        else:
            return balance['total'].get('USDT', 0)

    async def create_market_order(self, symbol, side, amount):
        return await self.client.create_market_order(symbol, side, amount)

    async def set_leverage(self, leverage, symbol):
        if self.mode == 'FUTURES':
            return await self.client.set_leverage(leverage, symbol)
        return None

    async def fetch_ohlcv(self, symbol, timeframe='1m', limit=200):
        return await self.client.fetch_ohlcv(symbol, timeframe, limit=limit)

    async def close(self):
        await self.client.close()
