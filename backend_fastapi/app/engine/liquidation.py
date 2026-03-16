from typing import Dict
from decimal import Decimal

class LiquidationEngine:
    def __init__(self, spike_threshold=Decimal("500000")):
        self.spike_threshold = spike_threshold
        self.cache = {} # {symbol: {"long_liq": 0, "short_liq": 0, "oi": 0}}

    def process_liquidation(self, symbol: str, side: str, volume: Decimal, open_interest: Decimal):
        """
        Calculates Liquidation Pressure Index (LPI)
        LPI = liquidation_volume / open_interest
        """
        if symbol not in self.cache:
            self.cache[symbol] = {"long_liq": Decimal("0"), "short_liq": Decimal("0")}
        
        if side == 'SELL': # Long liquidado
            self.cache[symbol]["long_liq"] += volume
        else: # Short liquidado
            self.cache[symbol]["short_liq"] += volume
            
        if open_interest <= 0:
            return 0
            
        lpi = volume / open_interest
        
        # Strategy: Signal reversal if LPI > 0.02
        if lpi > 0.02:
            print(f"🔥 Liquidation Spike! LPI: {lpi:.4f} on {symbol}")
            return lpi
            
        return 0

    def get_market_sentiment(self, symbol: str):
        data = self.cache.get(symbol)
        if not data:
            return "NEUTRAL"
            
        if data["long_liq"] > data["short_liq"] * 2:
            return "OVERSOLD" # Possible reversal UP
        elif data["short_liq"] > data["long_liq"] * 2:
            return "OVERBOUGHT" # Possible reversal DOWN
            
        return "NEUTRAL"
