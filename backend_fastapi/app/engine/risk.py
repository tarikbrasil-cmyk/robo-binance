from decimal import Decimal
from typing import Dict, Optional

class RiskManager:
    def __init__(self, daily_drawdown_limit=Decimal("0.12"), max_consecutive_losses=3):
        self.daily_drawdown_limit = daily_drawdown_limit
        self.max_consecutive_losses = max_consecutive_losses
        
        # Default Risk Params
        self.tp_perc = Decimal("0.06")
        self.sl_perc = Decimal("0.03")
        self.leverage = 10
        
        self.kill_switch = False
        self.consecutive_losses = 0
        self.daily_start_equity = Decimal("0")

    def calculate_kelly_size(self, win_rate: float, reward_risk_ratio: float):
        """
        f = (win_rate * (reward_risk_ratio + 1) - 1) / reward_risk_ratio
        """
        if reward_risk_ratio <= 0:
            return 0
        
        kelly_f = (win_rate * (reward_risk_ratio + 1) - 1) / reward_risk_ratio
        
        # Use fractional Kelly (e.g., 1/4 Kelly) for safety
        safe_kelly = max(0, kelly_f * 0.25)
        return min(1.0, safe_kelly)

    def calculate_position_size(self, balance: Decimal, confidence: float, win_rate=0.55):
        """
        Adjust size based on confidence (probability-based scaling)
        """
        size_ratio = Decimal("1.0")
        
        if confidence <= 0.55: size_ratio = Decimal("0.40")
        elif confidence <= 0.60: size_ratio = Decimal("0.60")
        elif confidence <= 0.70: size_ratio = Decimal("0.80")
        
        # Combine with Kelly logic (simplified)
        kelly_size = self.calculate_kelly_size(win_rate, float(self.tp_perc / self.sl_perc))
        
        final_ratio = Decimal(str(kelly_size)) if kelly_size > 0 else size_ratio
        
        return balance * final_ratio

    def can_open_position(self, current_equity: Decimal):
        if self.kill_switch:
            return False
            
        if self.daily_start_equity > 0:
            drawdown = (self.daily_start_equity - current_equity) / self.daily_start_equity
            if drawdown >= self.daily_drawdown_limit:
                print(f"🛑 Kill switch active! Drawdown: {drawdown*100}%")
                return False
                
        return True
