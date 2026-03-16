import logging
from .exchange_client import ExchangeClient

logger = logging.getLogger("OrderExecutor")

class OrderExecutor:
    def __init__(self):
        self.exchange = ExchangeClient()
        
    async def execute(self, trade_signal):
        symbol = trade_signal['symbol']
        side = 'buy' if trade_signal['side'] == 'long' else 'sell'
        
        logger.info(f"⚡ EXECUTING: {trade_signal['strategy']} {trade_signal['side']} on {symbol}")
        
        # Base amount (should be calculated by RiskManager/Kelly)
        # For now, minimal amount for testing
        amount = 0.001 
        
        result = await self.exchange.create_market_order(symbol, side, amount)
        if result:
            logger.info(f"✅ Order confirmed: {result['id']}")
            return result
        return None
