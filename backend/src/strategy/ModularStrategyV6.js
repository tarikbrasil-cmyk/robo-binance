/**
 * Modular Strategy V6 (Optimization Engine Core)
 * Supports dynamic injection of parameters for grid search.
 */
export function buildModularParamsFromConfig(config = {}) {
    const trend = config.trendStrategy || {};

    return {
        rsiPeriod: trend.rsiPeriod ?? 14,
        rsiOverbought: trend.rsiOverbought ?? 55,
        rsiOversold: trend.rsiOversold ?? 45,
        emaFastPeriod: trend.emaFast ?? 20,
        emaSlowPeriod: trend.emaSlow ?? 200,
        emaHTFPeriod: trend.emaHTF ?? 1000,
        useEmaHTF: trend.useEmaHTF ?? false,
        atrMultiplier: trend.atrMultiplierSL ?? 1.5,
        tpMultiplier: trend.atrMultiplierTP ?? 3.0,
        useCandleConfirmation: trend.useCandleConfirmation ?? true,
        useMacd: trend.useMacd ?? false,
        macdFast: trend.macdFast ?? 12,
        macdSlow: trend.macdSlow ?? 26,
        macdSignal: trend.macdSignal ?? 9,
        useSessionFilter: trend.useSessionFilter ?? true,
        session: trend.session ?? 'NY',
        useBreakout: trend.useBreakout ?? false,
        useMeanReversion: trend.useMeanReversion ?? false,
    };
}

export function getModularStrategyName(params = {}) {
    if (params.useBreakout) return 'MODULAR_V6_BREAKOUT';
    if (params.useMeanReversion) return 'MODULAR_V6_MEAN_REVERSION';
    return 'MODULAR_V6_PULLBACK';
}

export function evaluateModularStrategyV6(candles, indicators, index, optParams, symbol) {
    const idx = index;
    const candle = candles[idx];
    const prevCandle = index > 0 ? candles[idx - 1] : null;
    const indicator = indicators[idx];
    const prevIndicator = index > 0 ? indicators[idx - 1] : null;

    if (!indicator || !prevIndicator || !prevCandle) return null;

    // 1. EXTRACT OPTIMIZATION PARAMETERS
    const {
        rsiPeriod = 14,
        rsiOverbought = 70,
        rsiOversold = 30,
        emaFastPeriod = 20,
        emaSlowPeriod = 50,
        emaHTFPeriod = 200,
        useEmaHTF = true,
        volumeMultiplier = 1.5,
        atrMultiplier = 1.5,
        tpMultiplier = 3.0,
        useCandleConfirmation = true,
        useMacd = false,
        macdFast = 12,
        macdSlow = 26,
        macdSignal = 9,
        useSessionFilter = true,
        session = 'NY', // NY, LONDON, ASIA
        useBreakout = false,
        useMeanReversion = false
    } = optParams;

    // 1.5 SESSION FILTER
    if (useSessionFilter) {
        const date = new Date(candle.ts);
        const hour = date.getUTCHours();
        // ASIA: 00-08 UTC, LONDON: 08-16 UTC, NY: 13-21 UTC
        const sessions = {
            'ASIA': hour >= 0 && hour < 8,
            'LONDON': hour >= 8 && hour < 16,
            'NY': hour >= 13 && hour < 21
        };
        if (!sessions[session]) return null;
    }
    // For Grid Search, we assume the Engine pre-calculates the necessary indicator arrays
    const { 
        rsi, 
        emaFast, 
        emaSlow, 
        emaHTF, 
        volSma, 
        volume, 
        atr,
        macd 
    } = indicator;

    if (rsi === null || emaFast === null || emaSlow === null || volSma === null) return null;

    // 3. TREND BIAS
    const isTrendUp = useEmaHTF ? (candle.close > emaHTF && emaFast > emaSlow) : (emaFast > emaSlow);
    const isTrendDown = useEmaHTF ? (candle.close < emaHTF && emaFast < emaSlow) : (emaFast < emaSlow);

    // 4. MOMENTUM (MACD)
    let macdBullish = true;
    let macdBearish = true;
    if (useMacd && macd) {
        macdBullish = macd.MACD > macd.signal;
        macdBearish = macd.MACD < macd.signal;
    }

    // 5. VOLUME CONFIRMATION (Disabled for initial discovery)
    const volumeOk = true; 

    // 6. CANDLE CONFIRMATION (Stronger)
    const bullishConfirm = !useCandleConfirmation || (candle.close > candle.open && candle.close > prevCandle.high && candle.close > emaFast);
    const bearishConfirm = !useCandleConfirmation || (candle.close < candle.open && candle.close < prevCandle.low && candle.close < emaFast);

    // 7. ENTRY TRIGGERS
    
    // BUY
    const hasBreakoutLevels = indicator.highestHigh20 !== null && indicator.lowestLow20 !== null;
    const hasBands = indicator.bb?.lower !== null && indicator.bb?.lower !== undefined && indicator.bb?.upper !== null && indicator.bb?.upper !== undefined;
    const isBreakoutBuy = useBreakout && hasBreakoutLevels && candle.close > indicator.highestHigh20 && volumeOk;
    const isPullbackBuy = !useBreakout && !useMeanReversion && rsi <= rsiOversold + 10 && volumeOk && bullishConfirm;
    const isMeanRevBuy = useMeanReversion && hasBands && rsi < 30 && candle.low < indicator.bb.lower && bullishConfirm;

    if (isTrendUp && (isBreakoutBuy || isPullbackBuy || isMeanRevBuy) && macdBullish) {
        return buildSignalV6(symbol, 'BUY', candle.close, atr, optParams);
    }

    // SELL
    const isBreakoutSell = useBreakout && hasBreakoutLevels && candle.close < indicator.lowestLow20 && volumeOk;
    const isPullbackSell = !useBreakout && !useMeanReversion && rsi >= rsiOverbought - 10 && volumeOk && bearishConfirm;
    const isMeanRevSell = useMeanReversion && hasBands && rsi > 70 && candle.high > indicator.bb.upper && bearishConfirm;

    if (isTrendDown && (isBreakoutSell || isPullbackSell || isMeanRevSell) && macdBearish) {
        return buildSignalV6(symbol, 'SELL', candle.close, atr, optParams);
    }

    return null;
}

function buildSignalV6(symbol, signal, price, atr, optParams) {
    const slDist = atr * optParams.atrMultiplier;
    const tpDist = atr * optParams.tpMultiplier;

    return {
        symbol,
        signal,
        strategy: getModularStrategyName(optParams),
        entryPrice: price, 
        stopLossPrice: signal === 'BUY' ? price - slDist : price + slDist,
        takeProfitPrice: signal === 'BUY' ? price + tpDist : price - tpDist,
        tp1Price: null, // Optimization focuses on final R:R
        ts: Date.now()
    };
}
