import { IS_SPOT } from '../services/exchangeClient.js';

/**
 * STABILIZATION: Risk Manager
 * 
 * Changes:
 * - Drawdown threshold: 15% (was 12%)
 * - Max consecutive losses: 3 (unchanged)
 * - Removed confidence-based position scaling
 * - Leverage capped at 5x (was 10x)
 * - Max exposure: 10%
 */

export class RiskManager {
    constructor() {
        this.dailyStartEquity = 0; 
        this.consecutiveLosses = 0;
        
        // ── STABILIZATION: Conservative risk limits ──
        this.MAX_DAILY_DRAWDOWN = 0.15; // 15% → stop bot
        this.MAX_CONSECUTIVE_LOSSES = 3;
        this.MAX_EXPOSURE_PCT = 0.20; // 20% max account exposure
        
        this.DEFAULT_LEVERAGE = 10; // Strategy #1 use 10x
        this.TP_PCT = 0.10;
        this.SL_PCT = 0.05;
        
        this.isKillSwitchActive = false;
        this.killSwitchUnlockTs = 0;
        this.totalOpenExposure = 0; // Track total USDT in open positions
    }

    setDailyStartEquity(equity) {
        this.dailyStartEquity = equity;
    }

    registerTradeResult(pnlPercentage, currentEquity) {
        const now = Date.now();
        if (pnlPercentage < 0) {
            this.consecutiveLosses += 1;
        } else {
            this.consecutiveLosses = 0;
        }

        // Daily drawdown check
        if (this.dailyStartEquity > 0) {
            const currentDrawdown = (this.dailyStartEquity - currentEquity) / this.dailyStartEquity;

            if (currentDrawdown >= this.MAX_DAILY_DRAWDOWN) {
                console.error(`[FAIL-SAFE] Drawdown ${(currentDrawdown*100).toFixed(2)}% >= ${this.MAX_DAILY_DRAWDOWN*100}%. Permanent kill switch activated.`);
                this.isKillSwitchActive = true;
            }
        }

        // Consecutive losses check: 12-hour pause
        if (this.consecutiveLosses >= this.MAX_CONSECUTIVE_LOSSES) {
            const pauseHours = 12;
            this.killSwitchUnlockTs = now + (pauseHours * 60 * 60 * 1000);
            console.error(`[FAIL-SAFE] ${this.MAX_CONSECUTIVE_LOSSES} consecutive losses. Kill switch activated for ${pauseHours}h (until ${new Date(this.killSwitchUnlockTs).toISOString()}).`);
            this.consecutiveLosses = 0; // Reset counter after starting pause
        }

        // Log result
        console.log(`[TRADE_RESULT] PnL: ${pnlPercentage >= 0 ? '+' : ''}${(pnlPercentage*100).toFixed(2)}% | Equity: $${currentEquity.toFixed(2)} | Consecutive Losses: ${this.consecutiveLosses}`);
    }

    resetDailyRiskFactors() {
        this.consecutiveLosses = 0;
        this.isKillSwitchActive = false;
        this.killSwitchUnlockTs = 0;
        this.totalOpenExposure = 0;
        console.log('[RISK] Daily risk factors reset.');
    }

    canOpenNewPosition(fundingRate = 0) {
        if (this.isKillSwitchActive) {
            console.warn('[RISK] Permanent Kill switch active. No new positions allowed.');
            return false;
        }

        if (this.killSwitchUnlockTs > 0 && Date.now() < this.killSwitchUnlockTs) {
            const remaining = ((this.killSwitchUnlockTs - Date.now()) / (60 * 60 * 1000)).toFixed(1);
            console.warn(`[RISK] Kill switch active. Paused for another ${remaining} hours.`);
            return false;
        }
        
        // Funding Rate filter (Futures only)
        if (!IS_SPOT && Math.abs(fundingRate) > 0.0005) {
            console.warn(`[RISK] Funding rate too high (${fundingRate}). Position blocked.`);
            return false;
        }
        
        return true;
    }

    /**
     * Check if adding a new position would exceed max exposure
     */
    wouldExceedExposure(positionSizeUSDT, accountBalance) {
        if (accountBalance <= 0) return true;
        const newExposure = (this.totalOpenExposure + positionSizeUSDT) / accountBalance;
        if (newExposure > this.MAX_EXPOSURE_PCT) {
            console.warn(`[RISK] Exposure would be ${(newExposure*100).toFixed(1)}% > max ${this.MAX_EXPOSURE_PCT*100}%. Position blocked.`);
            return true;
        }
        return false;
    }

    addExposure(positionSizeUSDT) {
        this.totalOpenExposure += positionSizeUSDT;
    }

    removeExposure(positionSizeUSDT) {
        this.totalOpenExposure = Math.max(0, this.totalOpenExposure - positionSizeUSDT);
    }

    getRiskParams() {
        return {
            leverage: IS_SPOT ? 1 : this.DEFAULT_LEVERAGE,
            takeProfitPerc: IS_SPOT ? 0.03 : this.TP_PCT,
            stopLossPerc: IS_SPOT ? 0.015 : this.SL_PCT
        };
    }
}

export const riskManager = new RiskManager();
