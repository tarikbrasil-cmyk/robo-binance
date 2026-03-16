import { IS_SPOT } from '../services/exchangeClient.js';

export class RiskManager {
    constructor(dbOrAnalytics) {
        // Inicializa estado diário global em memória
        this.dailyStartEquity = 0; 
        this.consecutiveLosses = 0;
        
        // Regras Hardcoded Iniciais
        this.MAX_DAILY_DRAWDOWN = 0.12; // 12% max
        this.MAX_CONSECUTIVE_LOSSES = 3;
        
        this.TP_PCT = 0.06; // 6%
        this.SL_PCT = 0.03; // 3%
        this.DEFAULT_LEVERAGE = 10;
        
        // Estado
        this.isKillSwitchActive = false;
    }

    setDailyStartEquity(equity) {
        this.dailyStartEquity = equity;
    }

    /**
     * Atualiza perdas e ganhos para gerir Drawdown Global e Múltiplos Loses
     */
    registerTradeResult(pnlPercentage, currentEquity) {
        if (pnlPercentage < 0) {
            this.consecutiveLosses += 1;
        } else {
            this.consecutiveLosses = 0;
        }

        // Calcula Drawdown diário
        const currentDrawdown = (this.dailyStartEquity - currentEquity) / this.dailyStartEquity;

        if (currentDrawdown >= this.MAX_DAILY_DRAWDOWN) {
            console.error(`[KILL SWITCH] Drawdown de ${(currentDrawdown*100).toFixed(2)}% alcançou limite de 12%. Travando bot.`);
            this.isKillSwitchActive = true;
        }

        if (this.consecutiveLosses >= this.MAX_CONSECUTIVE_LOSSES) {
            console.error(`[KILL SWITCH] ${this.MAX_CONSECUTIVE_LOSSES} perdas consecutivas. Bot de Trading suspenso.`);
            this.isKillSwitchActive = true;
        }
    }

    resetDailyRiskFactors() {
        this.consecutiveLosses = 0;
        this.isKillSwitchActive = false;
        console.log('[RISK MANAGER] Respostas de Risco resetadas pra novo ciclo.');
    }

    canOpenNewPosition(fundingRate = 0) {
        if (this.isKillSwitchActive) return false;
        
        // Funding Rate só é relevante em Futuros
        if (!IS_SPOT && Math.abs(fundingRate) > 0.0005) { // 0.05%
            console.warn('[RISK MANAGER] Funding Rate muito alto. Operação cancelada.');
            return false;
        }
        
        return true;
    }

    /**
     * Compounding Dinâmico de Exposição (Statistical Sizing)
     * Usando uma variação de Confiança (0.5 a 1.0) para definir quanto da banca arriscar
     */
    calculatePositionSize(availableBalance, confidenceScore = 1) {
        let sizeRatio = 1.0; 

        if (confidenceScore <= 0.55) sizeRatio = 0.40;
        else if (confidenceScore <= 0.60) sizeRatio = 0.60;
        else if (confidenceScore <= 0.70) sizeRatio = 0.80;

        // Proteção Extra: Se o Drawdown atual já estiver amargo (> 8%), corta pela metade
        const currentDrawdown = (this.dailyStartEquity - availableBalance) / this.dailyStartEquity;
        if (currentDrawdown > 0.08) {
            sizeRatio = sizeRatio * 0.5;
            console.log(`[RISK MANAGER] [${IS_SPOT ? 'SPOT' : 'FUTURES'}] Drawdown Global alto (${(currentDrawdown*100).toFixed(1)}%). Posição cortada (Safe Mode)`);
        }

        // Target Growth Logic
        // SPOT: RIGIDAMENTE 1x leverage, sem short.
        let currentLeverage = IS_SPOT ? 1 : this.DEFAULT_LEVERAGE;
        let currentTp = IS_SPOT ? 0.03 : this.TP_PCT; // SPOT: alvo conservador de 3%
        let currentSl = IS_SPOT ? 0.015 : this.SL_PCT; // SPOT: stop conservador de 1.5%

        if (!IS_SPOT && availableBalance > 500) {
            // Futuros: Conta maior = Modo Conservador
            currentLeverage = 5;
            currentTp = 0.04;
            currentSl = 0.02;
        }

        // Garantia absoluta para Spot (Double Check)
        if (IS_SPOT) currentLeverage = 1;

        this.currentRiskSetup = {
            leverage: currentLeverage,
            takeProfitPerc: currentTp,
            stopLossPerc: currentSl
        }

        return availableBalance * sizeRatio;
    }

    getRiskParams() {
        return this.currentRiskSetup || {
            leverage: this.DEFAULT_LEVERAGE,
            takeProfitPerc: this.TP_PCT,
            stopLossPerc: this.SL_PCT
        };
    }
}

export const riskManager = new RiskManager();
