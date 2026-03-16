import ccxt.async_support as ccxt
import os
import logging
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger("ExchangeClient")

class ExchangeClient:
    def __init__(self, mode="FUTURES", testnet=True):
        self.mode = mode.upper()
        self.testnet = testnet
        
        exchange_id = 'binance' if self.mode == 'SPOT' else 'binanceusdm'
        
        self.client = getattr(ccxt, exchange_id)({
            'apiKey': os.getenv("BINANCE_API_KEY"),
            'secret': os.getenv("BINANCE_API_SECRET"),
            'enableRateLimit': True,
            'options': {
                'defaultType': 'spot' if self.mode == 'SPOT' else 'future',
            }
        })
        
        if self.testnet:
            self.client.set_sandbox_mode(True)
            logger.warning(f"⚠️ Exchange {exchange_id} in SANDBOX mode")

    async def fetch_tickers(self):
        try:
            return await self.client.fetch_tickers()
        except Exception as e:
            logger.error(f"Error fetching tickers: {e}")
            return {}

    async def fetch_ohlcv(self, symbol, timeframe='1m', limit=100):
        try:
            return await self.client.fetch_ohlcv(symbol, timeframe, limit=limit)
        except Exception as e:
            logger.error(f"Error fetching OHLCV for {symbol}: {e}")
            return []

    async def create_market_order(self, symbol, side, amount):
        try:
            return await self.client.create_market_order(symbol, side, amount)
        except Exception as e:
            logger.error(f"Error creating order for {symbol}: {e}")
            return None

    async def close(self):
        await self.client.close()
