import logging
import pandas as pd
import pandas_ta as ta
from .exchange_client import ExchangeClient

logger = logging.getLogger("StrategyManager")

class StrategyManager:
    def __init__(self):
        self.exchange = ExchangeClient()
        
    async def analyze(self, opportunity):
        symbol = opportunity['symbol']
        logger.info(f"📊 Analyzing {symbol} for strategy signals...")
        
        # Fetch OHLCV data
        ohlcv = await self.exchange.fetch_ohlcv(symbol, timeframe='5m', limit=100)
        if not ohlcv:
            return None
            
        df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        
        # 1. EMA Cross Strategy (Trend)
        df['ema_fast'] = ta.ema(df['close'], length=9)
        df['ema_slow'] = ta.ema(df['close'], length=21)
        
        # 2. RSI Indicator (Momentum)
        df['rsi'] = ta.rsi(df['close'], length=14)
        
        last_row = df.iloc[-1]
        prev_row = df.iloc[-2]
        
        # Strategy Logic: EMA Golden Cross + RSI confirmation
        if prev_row['ema_fast'] <= prev_row['ema_slow'] and last_row['ema_fast'] > last_row['ema_slow']:
            if last_row['rsi'] > 50:
                logger.info(f"🟢 [STRATEGY] Golden Cross detected for {symbol}")
                return {
                    'symbol': symbol,
                    'side': 'long',
                    'strategy': 'EMA_CROSS',
                    'price': last_row['close'],
                    'timestamp': last_row['timestamp']
                }
        
        # Strategy Logic: EMA Death Cross + RSI confirmation
        if prev_row['ema_fast'] >= prev_row['ema_slow'] and last_row['ema_fast'] < last_row['ema_slow']:
            if last_row['rsi'] < 50:
                logger.info(f"🔴 [STRATEGY] Death Cross detected for {symbol}")
                return {
                    'symbol': symbol,
                    'side': 'short',
                    'strategy': 'EMA_CROSS',
                    'price': last_row['close'],
                    'timestamp': last_row['timestamp']
                }
                
        return None
