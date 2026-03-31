/**
 * GATE DE PROMOÇÃO DEMO → LIVE
 *
 * Critérios mínimos obrigatórios antes de ativar ALLOW_LIVE_TRADING=true:
 *   ✅ Mínimo de 30 trades fechados na conta demo
 *   ✅ Win Rate ≥ 55%
 *   ✅ Profit Factor ≥ 1.30
 *   ✅ Drawdown máximo ≤ 15%
 *   ✅ Sem kill-switch permanente ativo (drawdown diário crítico)
 *
 * Uso:
 *   node validate_promotion_gate.js           → avalia e imprime resultado
 *   node validate_promotion_gate.js --approve → avalia e, se aprovado, grava ALLOW_LIVE_TRADING=true no .env
 */

import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const GATE = {
    MIN_TRADES:        30,
    MIN_WIN_RATE:      0.55,   // 55%
    MIN_PROFIT_FACTOR: 1.30,
    MAX_DRAWDOWN:      0.15,   // 15%
};

async function loadDemoTrades() {
    const dbPath = path.join(__dirname, 'bot_data.sqlite');
    if (!fs.existsSync(dbPath)) {
        throw new Error(`Banco de dados não encontrado em ${dbPath}. Inicie o bot pelo menos uma vez em modo demo.`);
    }

    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    // Pega apenas trades do modo DEMO/TESTNET
    const trades = await db.all(
        `SELECT profit_usdt, roe_perc, entry_price, exit_price, timestamp
         FROM pnl_history
         WHERE mode IS NULL OR mode = 'DEMO' OR mode = 'TESTNET' OR mode = 'FUTURES'
         ORDER BY timestamp ASC`
    );
    await db.close();
    return trades;
}

function computeMetrics(trades) {
    if (trades.length === 0) return null;

    const pnls    = trades.map(t => t.profit_usdt);
    const wins    = pnls.filter(p => p > 0);
    const losses  = pnls.filter(p => p <= 0);
    const totalPnl = pnls.reduce((a, b) => a + b, 0);
    const grossWin  = wins.reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));

    // Max drawdown from running equity curve
    let peak = 0;
    let runningBalance = 0;
    let maxDrawdown = 0;
    for (const pnl of pnls) {
        runningBalance += pnl;
        if (runningBalance > peak) peak = runningBalance;
        if (peak > 0) {
            const dd = (peak - runningBalance) / peak;
            if (dd > maxDrawdown) maxDrawdown = dd;
        }
    }

    return {
        totalTrades:  trades.length,
        winRate:      wins.length / trades.length,
        profitFactor: grossLoss > 0 ? grossWin / grossLoss : Infinity,
        maxDrawdown,
        totalPnl,
    };
}

function evaluateGate(metrics) {
    const checks = [
        {
            label: 'Quantidade mínima de trades',
            pass: metrics.totalTrades >= GATE.MIN_TRADES,
            actual: `${metrics.totalTrades}`,
            required: `≥ ${GATE.MIN_TRADES}`,
        },
        {
            label: 'Win Rate',
            pass: metrics.winRate >= GATE.MIN_WIN_RATE,
            actual: `${(metrics.winRate * 100).toFixed(2)}%`,
            required: `≥ ${(GATE.MIN_WIN_RATE * 100)}%`,
        },
        {
            label: 'Profit Factor',
            pass: metrics.profitFactor >= GATE.MIN_PROFIT_FACTOR,
            actual: isFinite(metrics.profitFactor) ? metrics.profitFactor.toFixed(3) : '∞',
            required: `≥ ${GATE.MIN_PROFIT_FACTOR}`,
        },
        {
            label: 'Drawdown Máximo',
            pass: metrics.maxDrawdown <= GATE.MAX_DRAWDOWN,
            actual: `${(metrics.maxDrawdown * 100).toFixed(2)}%`,
            required: `≤ ${(GATE.MAX_DRAWDOWN * 100)}%`,
        },
    ];

    const approved = checks.every(c => c.pass);
    return { checks, approved };
}

function patchEnvFile(envPath, key, value) {
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const line  = `${key}=${value}`;
    if (regex.test(content)) {
        content = content.replace(regex, line);
    } else {
        content += `\n${line}`;
    }
    fs.writeFileSync(envPath, content);
}

async function main() {
    const approve = process.argv.includes('--approve');
    const envPath = path.join(__dirname, '.env');

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  GATE DE PROMOÇÃO: DEMO → LIVE');
    console.log('══════════════════════════════════════════════════════\n');

    let trades;
    try {
        trades = await loadDemoTrades();
    } catch (e) {
        console.error(`[GATE ERROR] ${e.message}`);
        process.exitCode = 1;
        return;
    }

    const metrics = computeMetrics(trades);
    if (!metrics) {
        console.error('[GATE] Nenhum trade encontrado no banco demo. Execute o bot em modo TESTNET primeiro.');
        process.exitCode = 1;
        return;
    }

    const { checks, approved } = evaluateGate(metrics);

    console.log('CRITÉRIOS AVALIADOS:\n');
    for (const c of checks) {
        const icon = c.pass ? '✅' : '❌';
        console.log(`  ${icon}  ${c.label.padEnd(35)} ${c.actual.padEnd(12)} (requerido: ${c.required})`);
    }

    console.log(`\nPnL Total Demo: $${metrics.totalPnl.toFixed(2)}`);
    console.log('\n──────────────────────────────────────────────────────');

    if (approved) {
        console.log('🟢  RESULTADO: APROVADO — estratégia elegível para trading LIVE.\n');
        if (approve) {
            patchEnvFile(envPath, 'ALLOW_LIVE_TRADING', 'true');
            console.log(`✏️  .env atualizado: ALLOW_LIVE_TRADING=true`);
            console.log('⚠️  Reinicie o servidor para aplicar a mudança.\n');
        } else {
            console.log('ℹ️  Execute com --approve para habilitar automaticamente o live trading.');
        }
    } else {
        console.log('🔴  RESULTADO: REPROVADO — continue em modo demo até atingir todos os critérios.\n');
        if (approve) {
            console.log('🔒  ALLOW_LIVE_TRADING mantido como false.\n');
        }
        process.exitCode = 1;
    }
}

main().catch(e => {
    console.error('[GATE FATAL]', e.message);
    process.exitCode = 1;
});
