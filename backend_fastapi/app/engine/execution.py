from .ccxt_client import ExchangeClient
from .risk import RiskManager
from decimal import Decimal
import asyncio

class OrderRouter:
    def __init__(self, exchange: ExchangeClient, risk: RiskManager):
        self.exchange = exchange
        self.risk = risk
        self.active_trades = {} # {symbol: trade_data}

    async def execute_trade(self, symbol: str, side: str, confidence: float, current_price: Decimal):
        # 1. Check Risk
        balance = await self.exchange.fetch_balance()
        if not self.risk.can_open_position(Decimal(str(balance))):
            return None

        # 2. Calc Size
        quantity_usdt = self.risk.calculate_position_size(Decimal(str(balance)), confidence)
        amount = float(quantity_usdt / current_price)

        # 3. Apply Leverage
        await self.exchange.set_leverage(self.risk.leverage, symbol)

        # 4. Entry Order
        try:
            print(f"🚀 [EXECUTION] {side} {amount} {symbol} @ {current_price}")
            order = await self.exchange.create_market_order(symbol, side, amount)
            
            # 5. Set TP/SL
            # Logic for TP/SL orders would go here (Fetch params from risk)
            
            trade_data = {
                "symbol": symbol,
                "side": side,
                "entry_price": current_price,
                "quantity": amount,
                "status": "OPEN"
            }
            self.active_trades[symbol] = trade_data
            return trade_data
            
        except Exception as e:
            print(f"❌ Execution Error: {str(e)}")
            return None

    async def monitor_positions(self):
        # Background loop for trailing stops and cleanup
        pass
