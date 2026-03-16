import logging
import json
import redis
from .exchange_client import ExchangeClient

logger = logging.getLogger("MarketScanner")

class MarketScanner:
    def __init__(self):
        self.exchange = ExchangeClient()
        self.r = redis.Redis(host='localhost', port=6379, db=0)
        
    async def scan(self):
        # Scan for high-volatility/volume opportunities
        logger.info("🔍 Scanning market for opportunities...")
        tickers = await self.exchange.fetch_tickers()
        
        opportunities = []
        for symbol, ticker in tickers.items():
            if ticker['quoteVolume'] and ticker['quoteVolume'] > 1000000: # Min 1M USDT volume
                change = ticker['percentage']
                if abs(change) > 3: # Volatility threshold
                    opportunities.append({
                        'symbol': symbol,
                        'change': f"{change:+.2f}%",
                        'volume': f"${ticker['quoteVolume']/1000000:.1f}M",
                        'price': ticker['last'],
                        'score': abs(change) * (ticker['quoteVolume'] / 10000000) # Simple score
                    })
        
        # Sort by score and limit to top results
        opportunities.sort(key=lambda x: x['score'], reverse=True)
        results = opportunities[:10]
        
        # Broadcast to Redis
        self.r.set('bot:opportunities', json.dumps(results))
        return results
