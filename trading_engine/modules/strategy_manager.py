import logging
import pandas as pd
import pandas_ta as ta
from .exchange_client import ExchangeClient
from .regime_detector import detect_regime

logger = logging.getLogger("StrategyManager")

class StrategyManager:
    def __init__(self):
        self.exchange = ExchangeClient()
        
    async def analyze(self, opportunity):
        symbol = opportunity['symbol']
        logger.info(f"📊 Analyzing {symbol} for strategy signals...")
        
        # 1. Higher Timeframe (HTF) Analysis: 1h for Regime and Core Trend
        ohlcv_1h = await self.exchange.fetch_ohlcv(symbol, timeframe='1h', limit=250)
        if not ohlcv_1h:
             return None
             
        df_1h = pd.DataFrame(ohlcv_1h, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        
        # Detect Market Regime
        regime = detect_regime(df_1h)
        logger.info(f"🌍 Market Regime for {symbol}: {regime}")
        
        # We only want to trend-trade in TRENDING or VOLATILE regimes (depending on risk profile)
        # RANGING might require a different strategy. For now, we apply standard logic.
        
        df_1h['ema_200'] = ta.ema(df_1h['close'], length=200)
        latest_1h = df_1h.iloc[-1]
        
        # 2. Execution Timeframe (LTF) Analysis: 5m for Entries
        ohlcv_5m = await self.exchange.fetch_ohlcv(symbol, timeframe='5m', limit=100)
        if not ohlcv_5m:
            return None
            
        df_5m = pd.DataFrame(ohlcv_5m, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        
        # Indicators for 5m
        df_5m['ema_fast'] = ta.ema(df_5m['close'], length=9)
        df_5m['ema_slow'] = ta.ema(df_5m['close'], length=21)
        df_5m['rsi'] = ta.rsi(df_5m['close'], length=14)
        df_5m['vol_avg'] = ta.sma(df_5m['volume'], length=20)
        
        df_5m['atr'] = ta.atr(df_5m['high'], df_5m['low'], df_5m['close'], length=14)
        df_5m['atr_ma'] = ta.sma(df_5m['atr'], length=20)
        
        last_row = df_5m.iloc[-1]
        prev_row = df_5m.iloc[-2]
        
        # Condition Variables
        
        # Trend Conditions (1h)
        # Check if HTF Trend is established (EMA 200)
        htf_up_trend = latest_1h['close'] > latest_1h['ema_200']
        htf_down_trend = latest_1h['close'] < latest_1h['ema_200']
        
        # Momentum Conditions (5m)
        is_golden_cross = prev_row['ema_fast'] <= prev_row['ema_slow'] and last_row['ema_fast'] > last_row['ema_slow']
        is_death_cross = prev_row['ema_fast'] >= prev_row['ema_slow'] and last_row['ema_fast'] < last_row['ema_slow']
        
        rsi_bullish = last_row['rsi'] > 55
        rsi_bearish = last_row['rsi'] < 45
        
        # Volume Filter (5m)
        volume_ok = last_row['volume'] > last_row['vol_avg']
        
        # Volatility Filter (5m): ATR must be above its average or rising
        volatility_ok = last_row['atr'] > last_row['atr_ma']
        
        # Strategy Logic: LONG
        if is_golden_cross and rsi_bullish and htf_up_trend and volume_ok and volatility_ok:
            logger.info(f"🟢 [STRATEGY] Long signal for {symbol} | Regime: {regime} | RSI: {last_row['rsi']:.2f} | HTF Trend: UP | Vol: {last_row['volume']:.0f} > Avg")
            return {
                'symbol': symbol,
                'side': 'long',
                'strategy': 'MTF_EMA_CROSS',
                'regime': regime,
                'price': last_row['close'],
                'timestamp': last_row['timestamp']
            }
        
        # Strategy Logic: SHORT
        if is_death_cross and rsi_bearish and htf_down_trend and volume_ok and volatility_ok:
            logger.info(f"🔴 [STRATEGY] Short signal for {symbol} | Regime: {regime} | RSI: {last_row['rsi']:.2f} | HTF Trend: DOWN | Vol: {last_row['volume']:.0f} > Avg")
            return {
                'symbol': symbol,
                'side': 'short',
                'strategy': 'MTF_EMA_CROSS',
                'regime': regime,
                'price': last_row['close'],
                'timestamp': last_row['timestamp']
            }
                
        return None
