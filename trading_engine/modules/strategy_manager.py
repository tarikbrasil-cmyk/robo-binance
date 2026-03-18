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
        ohlcv = await self.exchange.fetch_ohlcv(symbol, timeframe='5m', limit=300)
        if not ohlcv:
            return None
            
        df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        
        # 1. Trend Indicators (EMA)
        df['ema_fast'] = ta.ema(df['close'], length=9)
        df['ema_slow'] = ta.ema(df['close'], length=21)
        df['ema_trend'] = ta.ema(df['close'], length=200)
        
        # 2. Momentum Indicators (RSI)
        df['rsi'] = ta.rsi(df['close'], length=14)
        
        # 3. Volume Filters
        df['vol_avg'] = ta.sma(df['volume'], length=20)
        
        # 4. Volatility (ATR)
        df['atr'] = ta.atr(df['high'], df['low'], df['close'], length=14)
        
        last_row = df.iloc[-1]
        prev_row = df.iloc[-2]
        
        # Strategy Logic: EMA Golden Cross + RSI > 55 + Price > EMA200 + Volume > Avg
        is_golden_cross = prev_row['ema_fast'] <= prev_row['ema_slow'] and last_row['ema_fast'] > last_row['ema_slow']
        if is_golden_cross:
            if last_row['rsi'] > 55 and last_row['close'] > last_row['ema_trend'] and last_row['volume'] > last_row['vol_avg']:
                logger.info(f"🟢 [STRATEGY] Long signal detected for {symbol} | RSI: {last_row['rsi']:.2f} | Vol: {last_row['volume']:.0f} > {last_row['vol_avg']:.0f}")
                return {
                    'symbol': symbol,
                    'side': 'long',
                    'strategy': 'EMA_CROSS_V2',
                    'price': last_row['close'],
                    'timestamp': last_row['timestamp']
                }
        
        # Strategy Logic: EMA Death Cross + RSI < 45 + Price < EMA200 + Volume > Avg
        is_death_cross = prev_row['ema_fast'] >= prev_row['ema_slow'] and last_row['ema_fast'] < last_row['ema_slow']
        if is_death_cross:
            if last_row['rsi'] < 45 and last_row['close'] < last_row['ema_trend'] and last_row['volume'] > last_row['vol_avg']:
                logger.info(f"🔴 [STRATEGY] Short signal detected for {symbol} | RSI: {last_row['rsi']:.2f} | Vol: {last_row['volume']:.0f} > {last_row['vol_avg']:.0f}")
                return {
                    'symbol': symbol,
                    'side': 'short',
                    'strategy': 'EMA_CROSS_V2',
                    'price': last_row['close'],
                    'timestamp': last_row['timestamp']
                }
                
        return None
