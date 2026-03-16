import pandas as pd
import pandas_ta as ta
from typing import List, Dict

class SignalEngine:
    def __init__(self):
        pass

    def analyze_trend_and_momentum(self, ohlcv_data: List[List]):
        """
        ohlcv_data: list of [timestamp, open, high, low, close, volume]
        """
        if not ohlcv_data or len(ohlcv_data) < 200:
            return {"signal": "NEUTRAL", "reason": "Not enough data"}

        df = pd.DataFrame(ohlcv_data, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        df['close'] = df['close'].astype(float)
        df['high'] = df['high'].astype(float)
        df['low'] = df['low'].astype(float)

        # Indicators
        df['ema20'] = ta.ema(df['close'], length=20)
        df['ema50'] = ta.ema(df['close'], length=50)
        df['ema200'] = ta.ema(df['close'], length=200)
        df['rsi'] = ta.rsi(df['close'], length=14)
        df['atr'] = ta.atr(df['high'], df['low'], df['close'], length=14)

        # Recent values
        curr = df.iloc[-1]
        
        is_uptrend = curr['ema20'] > curr['ema50'] > curr['ema200']
        is_downtrend = curr['ema20'] < curr['ema50'] < curr['ema200']
        
        current_rsi = curr['rsi']
        
        # BUY Rule: Uptrend + RSI < 35 (Pullback)
        if is_uptrend and current_rsi < 35:
            return {
                "signal": "BUY",
                "confidence": 0.8,
                "indicators": {"ema20": curr['ema20'], "rsi": current_rsi}
            }
            
        # SELL Rule: Downtrend + RSI > 65
        if is_downtrend and current_rsi > 65:
            return {
                "signal": "SELL",
                "confidence": 0.8,
                "indicators": {"ema20": curr['ema20'], "rsi": current_rsi}
            }

        return {"signal": "NEUTRAL", "reason": "No clear trend/momentum", "indicators": {"rsi": current_rsi}}
