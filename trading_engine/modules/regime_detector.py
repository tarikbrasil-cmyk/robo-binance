import pandas as pd
import pandas_ta as ta

def detect_regime(df: pd.DataFrame) -> str:
    """
    Classifies the market regime into TRENDING, RANGING, or VOLATILE.
    
    Args:
        df: DataFrame with OHLCV data. Requires at least 200 rows for EMA200.
        
    Returns:
        str: The detected market regime ('TRENDING', 'RANGING', 'VOLATILE', or 'UNKNOWN').
    """
    if df is None or len(df) < 200:
        return 'UNKNOWN'

    # Calculate required indicators
    # We create a copy to avoid SettingWithCopyWarning if df is a slice
    regime_df = df.copy()
    
    # 1. EMA 200 for Trend Direction
    regime_df['ema_200'] = ta.ema(regime_df['close'], length=200)
    
    # 2. ADX (Average Directional Index) for Trend Strength
    # pandas_ta adx returns a DataFrame with ADX, DMP, and DMN columns. 
    # We extract just the main ADX line.
    adx_df = ta.adx(regime_df['high'], regime_df['low'], regime_df['close'], length=14)
    if adx_df is not None and not adx_df.empty:
        regime_df['adx'] = adx_df.iloc[:, 0]  # The first column is ADX_14
    else:
        regime_df['adx'] = 0.0
        
    # 3. ATR for Volatility
    regime_df['atr'] = ta.atr(regime_df['high'], regime_df['low'], regime_df['close'], length=14)
    
    # 4. ATR Moving Average (to detect rapidly increasing ATR)
    regime_df['atr_ma'] = ta.sma(regime_df['atr'], length=20)

    # Get the latest values
    latest = regime_df.iloc[-1]
    
    price = latest['close']
    ema_200 = latest['ema_200']
    adx = latest['adx']
    atr = latest['atr']
    atr_ma = latest['atr_ma']

    # Handle NaNs from indicators that are still warming up
    if pd.isna(ema_200) or pd.isna(adx) or pd.isna(atr) or pd.isna(atr_ma):
        return 'UNKNOWN'

    # Classification Logic
    
    # VOLATILE: ATR is significantly above its average (e.g., rapidly increasing)
    # Using a 1.2x threshold to represent a significant volatility spike.
    if atr > atr_ma * 1.2:
        return 'VOLATILE'
        
    # TRENDING: High ADX and price is clearly above or below the EMA200
    is_trending_up = price > ema_200
    is_trending_down = price < ema_200
    
    if adx > 25 and (is_trending_up or is_trending_down):
        return 'TRENDING'
        
    # RANGING: Low ADX, indicates lack of clear trend
    if adx < 20:
        return 'RANGING'
        
    # Fallback for states not strictly defined (e.g., ADX between 20 and 25 without high volatility)
    # We'll default to RANGING in these transition periods if it's not strongly trending
    return 'RANGING'
