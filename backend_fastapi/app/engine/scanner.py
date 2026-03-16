from .ccxt_client import ExchangeClient
import pandas as pd
import pandas_ta as ta
import asyncio
from typing import List, Dict

class MarketScanner:
    def __init__(self, exchange: ExchangeClient):
        self.exchange = exchange
        self.top_opportunities = []

    async def scan_market(self, limit=50):
        print(f"🔍 [SCANNER] Scanning top {limit} markets...")
        try:
            tickers = await self.exchange.client.fetch_tickers()
            
            candidates = []
            for symbol, ticker in tickers.items():
                # Filter USDT pairs
                if not symbol.endswith('/USDT:USDT') and not symbol.endswith('/USDT'):
                    continue
                
                # Filter by volume (> 100M)
                quote_volume = ticker.get('quoteVolume', 0)
                if quote_volume and quote_volume > 100_000_000:
                    volatility = (ticker['high'] - ticker['low']) / ticker['last'] if ticker['last'] else 0
                    momentum = abs(ticker.get('percentage', 0))
                    
                    score = (volatility * 100 * 0.4) + (momentum * 0.3)
                    
                    candidates.append({
                        "symbol": symbol,
                        "volume": quote_volume,
                        "volatility": volatility,
                        "momentum": momentum,
                        "score": score
                    })

            # Sort and pick top 5
            candidates.sort(key=lambda x: x['score'], reverse=True)
            self.top_opportunities = candidates[:5]
            
            print(f"✅ [SCANNER] Found {len(self.top_opportunities)} top opportunities")
            return self.top_opportunities

        except Exception as e:
            print(f"❌ [SCANNER] Error: {str(e)}")
            return []
