import logging
import json
import redis
from .exchange_client import ExchangeClient

logger = logging.getLogger("PositionManager")

class PositionManager:
    def __init__(self):
        self.exchange = ExchangeClient()
        self.r = redis.Redis(host='localhost', port=6379, db=0)
        
    async def update(self):
        # logger.info("📋 Updating active positions...")
        try:
            # Fetch positions from exchange
            balance = await self.exchange.client.fetch_balance()
            positions = balance.get('info', {}).get('positions', [])
            
            active_positions = []
            for pos in positions:
                if float(pos.get('positionAmt', 0)) != 0:
                    active_positions.append({
                        'symbol': pos['symbol'],
                        'amount': pos['positionAmt'],
                        'entry_price': pos['entryPrice'],
                        'unrealized_pnl': pos['unRealizedProfit'],
                        'leverage': pos['leverage']
                    })
            
            # Broadcast to Redis for API/Dashboard visibility
            if active_positions:
                self.r.set('bot:active_positions', json.dumps(active_positions))
                # logger.info(f"✅ Positions updated in Redis: {len(active_positions)} active")
            else:
                self.r.delete('bot:active_positions')
                
        except Exception as e:
            logger.error(f"Error updating positions: {e}")
