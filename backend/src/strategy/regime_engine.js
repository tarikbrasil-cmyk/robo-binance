import fs from 'fs';
import path from 'path';
import { EMA, RSI, ATR, ADX, SMA } from 'technicalindicators';

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

export function calculateIndicators(candles) {
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);
    
    const ema50 = padArray(candles.length, EMA.calculate({ period: 50, values: closes }));
    const ema200 = padArray(candles.length, EMA.calculate({ period: 200, values: closes }));
    const rsi = padArray(candles.length, RSI.calculate({ period: 14, values: closes }));
    const atr = padArray(candles.length, ATR.calculate({ period: 14, high: highs, low: lows, close: closes }));
    const adxObj = padArray(candles.length, ADX.calculate({ period: 14, high: highs, low: lows, close: closes }));
    // Volume SMA
    const volSma20 = padArray(candles.length, SMA.calculate({ period: 20, values: volumes }));
    
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
        const emaSlope = (i > 0 && ema50[i] !== null && ema50[i-1] !== null) ? (ema50[i] - ema50[i-1]) : 0;

        indicators.push({
            ema50: ema50[i],
            ema200: ema200[i],
            emaSlope,
            rsi: rsi[i],
            atr: currentAtr,
            atrPercent,
            adx: adxObj[i] ? adxObj[i].adx : null,
            vwap: currentVwap,
            vwapStdDev: currentStd,
            zscore,
            volSma20: volSma20[i],
            atrSma50: atrSma50[i],
            atrSma100: atrSma100[i],
            volume: volumes[i],
            highestHigh20: highs20[i],
            lowestLow20: lows20[i]
        });
    }
    
    return indicators;
}

export function detectMarketRegime(indicator, config) {
    if (!indicator || 
        indicator.adx === null || 
        indicator.ema50 === null || 
        indicator.ema200 === null || 
        indicator.atr === null || 
        indicator.atrSma50 === null) {
        return 'NEUTRAL';
    }
    
    const { adx, atr, atrPercent } = indicator;
    const regimeConfig = config.regime;
    
    // 1. Minimum Volatility Filter
    if (atrPercent < (regimeConfig.minVolatilityPercent || 0.003)) {
        return 'NEUTRAL'; // Too dead to trade
    }

    // 2. ADX-based Regime
    if (adx > regimeConfig.trendAdxThreshold) {
        return 'TREND';
    }
    
    if (adx < regimeConfig.rangingAdxThreshold) {
        return 'RANGE';
    }
    
    return 'NEUTRAL';
}

export function isMarketConditionAllowed(indicator, candle, config) {
    // 1. Volume Confirmation (V2: volume > 1.2 * SMA20)
    if (indicator.volume !== null && indicator.volSma20 !== null) {
        if (indicator.volume <= indicator.volSma20 * 1.2) {
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
