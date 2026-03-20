import fs from 'fs';
import path from 'path';
import { EMA, RSI, ATR, ADX, SMA, BollingerBands } from 'technicalindicators';

export function loadStrategyConfig() {
    const configPath = path.join(process.cwd(), 'config', 'strategy_config.json');
    if (!fs.existsSync(configPath)) {
        throw new Error("strategy_config.json not found");
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function padArray(targetLen, arr) {
    if (arr.length >= targetLen) return arr;
    const padding = new Array(targetLen - arr.length).fill(null);
    return [...padding, ...arr];
}

export function calculateIndicators(candles, config = null) {
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);
    
    const fastPeriod = config?.trendStrategy?.emaFast ?? 50;
    const slowPeriod = config?.trendStrategy?.emaSlow ?? 200;
    const volSmaPeriod = config?.trendStrategy?.volumeSma ?? 20;

    const emaFast = padArray(candles.length, EMA.calculate({ period: fastPeriod, values: closes }));
    const emaSlow = padArray(candles.length, EMA.calculate({ period: slowPeriod, values: closes }));
    const emaHTF = padArray(candles.length, EMA.calculate({ period: config?.trendStrategy?.emaHTF ?? 1000, values: closes }));
    const rsi = padArray(candles.length, RSI.calculate({ period: 14, values: closes }));
    const atr = padArray(candles.length, ATR.calculate({ period: 14, high: highs, low: lows, close: closes }));
    const adxObj = padArray(candles.length, ADX.calculate({ period: 14, high: highs, low: lows, close: closes }));
    // Volume SMA
    const volSma = padArray(candles.length, SMA.calculate({ period: volSmaPeriod, values: volumes }));
    
    // Bollinger Bands (20, 2)
    const bb = padArray(candles.length, BollingerBands.calculate({ period: 20, stdDev: 2, values: closes }));
    
    // filter nulls to safely pass array into another SMA
    const validAtr = atr.filter(a => a !== null);
    const rawAtrSma50 = SMA.calculate({ period: 50, values: validAtr });
    // pad to original candles length
    const atrSma50 = padArray(candles.length, rawAtrSma50);
    
    const rawAtrSma100 = SMA.calculate({ period: 100, values: validAtr });
    const atrSma100 = padArray(candles.length, rawAtrSma100);
    
    // High/Low lookback for breakout (20 periods)
    const highs20 = [];
    const lows20 = [];
    for (let i = 0; i < candles.length; i++) {
        if (i < 20) {
            highs20.push(null);
            lows20.push(null);
        } else {
            const window = highs.slice(i - 20, i);
            const windowL = lows.slice(i - 20, i);
            highs20.push(Math.max(...window));
            lows20.push(Math.min(...windowL));
        }
    }

    const vwap = [];
    const vwapStdDev = [];
    let cumulativeTypicalVolume = 0;
    let cumulativeVolume = 0;
    let currentDayStr = null;
    
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const date = new Date(c.ts);
        const dayStr = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
        
        if (dayStr !== currentDayStr) {
            cumulativeTypicalVolume = 0;
            cumulativeVolume = 0;
            currentDayStr = dayStr;
        }
        
        const typicalPrice = (c.high + c.low + c.close) / 3;
        cumulativeTypicalVolume += typicalPrice * c.volume;
        cumulativeVolume += c.volume;
        
        const currentVwap = cumulativeVolume === 0 ? c.close : cumulativeTypicalVolume / cumulativeVolume;
        vwap.push(currentVwap);

        // Standard Deviation for Z-Score (Simple sliding window or cumulative? User requested Z-score. Usually 20 period std dev of typical price)
        if (i < 20) {
            vwapStdDev.push(null);
        } else {
            const window = [];
            for(let j = i-20; j <= i; j++) window.push((candles[j].high + candles[j].low + candles[j].close) / 3);
            const mean = window.reduce((a, b) => a + b) / window.length;
            const variance = window.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / window.length;
            vwapStdDev.push(Math.sqrt(variance));
        }
    }
    
    const indicators = [];
    for (let i = 0; i < candles.length; i++) {
        const currentPrice = closes[i];
        const currentAtr = atr[i];
        const currentVwap = vwap[i];
        const currentStd = vwapStdDev[i];
        
        const zscore = (currentStd && currentStd !== 0) ? (currentPrice - currentVwap) / currentStd : 0;
        const atrPercent = (currentPrice > 0) ? (currentAtr / currentPrice) : 0;
        const emaFastSlope = (i > 0 && emaFast[i] !== null && emaFast[i-1] !== null) ? (emaFast[i] - emaFast[i-1]) : 0;

        indicators.push({
            ts: candles[i].ts, // Added for cooldown/backtest consistency
            emaFast: emaFast[i],
            emaSlow: emaSlow[i],
            emaHTF: emaHTF[i],
            emaFastSlope,
            rsi: rsi[i],
            atr: currentAtr,
            atrPercent,
            adx: adxObj[i] ? adxObj[i].adx : null,
            vwap: currentVwap,
            vwapStdDev: currentStd,
            zscore,
            volSma: volSma[i],
            atrSma50: atrSma50[i],
            atrSma100: atrSma100[i],
            volume: volumes[i],
            highestHigh20: highs20[i],
            lowestLow20: lows20[i],
            bb: bb[i] // { upper, middle, lower }
        });
    }
    
    return indicators;
}

export function detectMarketRegime(indicator, config) {
    if (!indicator || 
        indicator.adx === undefined || indicator.adx === null || 
        indicator.emaFast === undefined || indicator.emaFast === null || 
        indicator.emaSlow === undefined || indicator.emaSlow === null || 
        indicator.atr === undefined || indicator.atr === null) {
        return 'NEUTRAL';
    }
    
    const { adx, atrPercent, emaFast, emaSlow, vwap } = indicator;
    const regimeConfig = config.regime;
    
    // 1. Low Volatility Filter
    if (atrPercent < (regimeConfig.minVolatilityPercent || 0.001)) {
        return 'LOW_VOL';
    }

    // 2. Trend Detection
    const isTrending = adx > (regimeConfig.trendAdxThreshold || 25);
    if (isTrending) {
        return 'TREND';
    }
    
    // 3. Range Detection
    if (adx < (regimeConfig.rangingAdxThreshold || 20)) {
        return 'RANGE';
    }
    
    return 'NEUTRAL';
}

/**
 * V5 Regime Classification
 * TRENDING: ADX > 25
 * SIDEWAYS: ADX < 20
 * VOLATILE: ATR > 2x ATR SMA 50
 */
export function classifyRegimeV5(indicator) {
    if (!indicator || indicator.adx === null || indicator.atr === null || indicator.atrSma50 === null) return 'NEUTRAL';
    
    // 1. VOLATILE / CHAOTIC (Highest priority)
    if (indicator.atr > indicator.atrSma50 * 2.0) {
        return 'VOLATILE';
    }

    // 2. TRENDING
    if (indicator.adx > 25) {
        return 'TRENDING';
    }

    // 3. SIDEWAYS
    if (indicator.adx < 20) {
        return 'SIDEWAYS';
    }

    return 'NEUTRAL';
}

/**
 * Basic Candle Patterns
 */
export function detectCandlePattern(candle, prevCandle) {
    if (!prevCandle) return null;
    
    const body = Math.abs(candle.close - candle.open);
    const prevBody = Math.abs(prevCandle.close - prevCandle.open);
    
    // Engulfing Bullish
    if (candle.close > candle.open && prevCandle.close < prevCandle.open && 
        candle.close > prevCandle.open && candle.open < prevCandle.close) {
        return 'ENGULFING_BULLISH';
    }
    
    // Engulfing Bearish
    if (candle.close < candle.open && prevCandle.close > prevCandle.open && 
        candle.close < prevCandle.open && candle.open > prevCandle.close) {
        return 'ENGULFING_BEARISH';
    }
    
    // Rejection Bullish (Pin bar/Hammer approx)
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    if (lowerWick > body * 2) return 'REJECTION_BULLISH';

    // Rejection Bearish
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    if (upperWick > body * 2) return 'REJECTION_BEARISH';

    return null;
}

export function isMarketConditionAllowed(indicator, candle, config) {
    // 1. Volume Confirmation
    if (indicator.volume !== null && indicator.volSma !== null) {
        const volumeMultiplier = config?.trendStrategy?.volumeMultiplier ?? 1.0;
        if (indicator.volume < indicator.volSma * volumeMultiplier) {
            return false;
        }
    }
    
    // Time filter avoidance 00:00 to 02:00
    const date = new Date(candle.ts);
    const currentHour = date.getUTCHours();
    const currentMin = date.getUTCMinutes();
    const timeNum = currentHour * 60 + currentMin; // Mins from midnight
    
    const startParts = config.general.avoidTimeStartUTC.split(':');
    const endParts = config.general.avoidTimeEndUTC.split(':');
    const startMin = parseInt(startParts[0])*60 + parseInt(startParts[1]);
    const endMin = parseInt(endParts[0])*60 + parseInt(endParts[1]);
    
    if (timeNum >= startMin && timeNum <= endMin) {
        return false;
    }
    
    return true;
}

/**
 * Detects Market Structure (HH, HL, LH, LL)
 */
export function detectMarketStructure(candles, index, window = 20) {
    if (index < window * 2) return 'NEUTRAL';

    const prices = candles.slice(index - (window * 2) + 1, index + 1);
    const highs = prices.map(c => c.high);
    const lows = prices.map(c => c.low);

    // Simplistic Peak/Valley detection
    const findPeaks = (arr) => {
        let peaks = [];
        for (let i = 1; i < arr.length - 1; i++) {
            if (arr[i] > arr[i - 1] && arr[i] > arr[i + 1]) peaks.push(arr[i]);
        }
        return peaks;
    };
    
    const findValleys = (arr) => {
        let valleys = [];
        for (let i = 1; i < arr.length - 1; i++) {
            if (arr[i] < arr[i - 1] && arr[i] < arr[i + 1]) valleys.push(arr[i]);
        }
        return valleys;
    };

    const peaks = findPeaks(highs).slice(-2);
    const valleys = findValleys(lows).slice(-2);

    if (peaks.length < 2 || valleys.length < 2) return 'NEUTRAL';

    const [prevPeak, currPeak] = peaks;
    const [prevValley, currValley] = valleys;

    if (currPeak > prevPeak && currValley > prevValley) return 'BULLISH_STRUCTURE'; // HH + HL
    if (currPeak < prevPeak && currValley < prevValley) return 'BEARISH_STRUCTURE'; // LH + LL

    return 'CHOPPY';
}

/**
 * Calculates the slope of a series over a window
 */
export function getEmaSlope(indicators, index, window = 10) {
    if (!indicators || index < window) return 0;
    
    const first = indicators[index - window].emaFast;
    const last = indicators[index].emaFast;
    
    if (first === null || last === null || first === 0) return 0;
    return (last - first) / first; // % change over window
}
