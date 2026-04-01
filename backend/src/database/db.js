import sqlite3 from 'sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create or open the database file
const dbPath = join(__dirname, '../../bot_data.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erro ao conectar no SQLite:', err.message);
  } else {
    console.log('✅ SQLite conectado com sucesso.');
    initDb();
  }
});

import { BOT_MODE } from '../services/exchangeClient.js';

function initDb() {
  db.serialize(() => {
    // Tabela de Logs (ações gerais do bot)
    db.run(`CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela de PnL (Registro de trades fechados)
    db.run(`CREATE TABLE IF NOT EXISTS pnl_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      type TEXT, -- LONG, SHORT, BUY
      entry_price REAL NOT NULL,
      exit_price REAL NOT NULL,
      profit_usdt REAL NOT NULL,
      roe_perc REAL NOT NULL,
      leverage INTEGER,
      contracts REAL,
      status TEXT, -- FILLED, CLOSED, LIQUIDATED
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS decision_journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT,
      source TEXT NOT NULL,
      event_type TEXT NOT NULL,
      symbol TEXT,
      side TEXT,
      strategy TEXT,
      decision TEXT NOT NULL,
      price REAL,
      reason TEXT,
      context_json TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_decision_journal_timestamp ON decision_journal(timestamp DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_decision_journal_symbol ON decision_journal(symbol)`);

    // Tabela de Estratégias salvas
    db.run(`CREATE TABLE IF NOT EXISTS strategies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL DEFAULT 'manual',
      params_json TEXT NOT NULL,
      symbol TEXT,
      timeframe TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      benchmark_validated INTEGER NOT NULL DEFAULT 0,
      backtest_validated INTEGER NOT NULL DEFAULT 0,
      benchmark_score REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Migração: Adicionar coluna mode se não existir (para DBs legados)
    db.all("PRAGMA table_info(logs)", (err, rows) => {
        if (!rows.find(r => r.name === 'mode')) {
            db.run("ALTER TABLE logs ADD COLUMN mode TEXT");
        }
    });
    db.all("PRAGMA table_info(pnl_history)", (err, rows) => {
        if (!rows.find(r => r.name === 'mode')) db.run("ALTER TABLE pnl_history ADD COLUMN mode TEXT");
        if (!rows.find(r => r.name === 'type')) db.run("ALTER TABLE pnl_history ADD COLUMN type TEXT");
        if (!rows.find(r => r.name === 'leverage')) db.run("ALTER TABLE pnl_history ADD COLUMN leverage INTEGER");
        if (!rows.find(r => r.name === 'contracts')) db.run("ALTER TABLE pnl_history ADD COLUMN contracts REAL");
        if (!rows.find(r => r.name === 'status')) db.run("ALTER TABLE pnl_history ADD COLUMN status TEXT");
    });
    db.all("PRAGMA table_info(decision_journal)", (err, rows) => {
      if (!rows.find(r => r.name === 'mode')) db.run("ALTER TABLE decision_journal ADD COLUMN mode TEXT");
      if (!rows.find(r => r.name === 'source')) db.run("ALTER TABLE decision_journal ADD COLUMN source TEXT");
      if (!rows.find(r => r.name === 'event_type')) db.run("ALTER TABLE decision_journal ADD COLUMN event_type TEXT");
      if (!rows.find(r => r.name === 'symbol')) db.run("ALTER TABLE decision_journal ADD COLUMN symbol TEXT");
      if (!rows.find(r => r.name === 'side')) db.run("ALTER TABLE decision_journal ADD COLUMN side TEXT");
      if (!rows.find(r => r.name === 'strategy')) db.run("ALTER TABLE decision_journal ADD COLUMN strategy TEXT");
      if (!rows.find(r => r.name === 'decision')) db.run("ALTER TABLE decision_journal ADD COLUMN decision TEXT");
      if (!rows.find(r => r.name === 'price')) db.run("ALTER TABLE decision_journal ADD COLUMN price REAL");
      if (!rows.find(r => r.name === 'reason')) db.run("ALTER TABLE decision_journal ADD COLUMN reason TEXT");
      if (!rows.find(r => r.name === 'context_json')) db.run("ALTER TABLE decision_journal ADD COLUMN context_json TEXT");
    });
  });
}

// Helpers
export function insertLog(type, message) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO logs (type, message, mode) VALUES (?, ?, ?)`, [type, message, BOT_MODE], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
}

export function insertPnL(symbol, side, entryPrice, exitPrice, profitUsdt, roePerc, extra = {}) {
  const { type, leverage, contracts, status } = extra;
  return new Promise((resolve, reject) => {
    const query = `INSERT INTO pnl_history (symbol, side, entry_price, exit_price, profit_usdt, roe_perc, mode, type, leverage, contracts, status) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    db.run(query, [symbol, side, entryPrice, exitPrice, profitUsdt, roePerc, BOT_MODE, type, leverage, contracts, status], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
}

export function insertDecisionEntry(entry) {
  const normalized = {
    source: entry.source || 'SYSTEM',
    eventType: entry.eventType || 'UNKNOWN',
    symbol: entry.symbol || null,
    side: entry.side || null,
    strategy: entry.strategy || null,
    decision: entry.decision || 'INFO',
    price: Number.isFinite(entry.price) ? entry.price : null,
    reason: entry.reason || null,
    context: entry.context || {},
  };

  return new Promise((resolve, reject) => {
    const contextJson = JSON.stringify(normalized.context);
    const query = `INSERT INTO decision_journal (source, event_type, symbol, side, strategy, decision, price, reason, context_json, mode)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.run(
      query,
      [
        normalized.source,
        normalized.eventType,
        normalized.symbol,
        normalized.side,
        normalized.strategy,
        normalized.decision,
        normalized.price,
        normalized.reason,
        contextJson,
        BOT_MODE,
      ],
      function (err) {
        if (err) {
          reject(err);
          return;
        }

        resolve({
          id: this.lastID,
          mode: BOT_MODE,
          source: normalized.source,
          event_type: normalized.eventType,
          symbol: normalized.symbol,
          side: normalized.side,
          strategy: normalized.strategy,
          decision: normalized.decision,
          price: normalized.price,
          reason: normalized.reason,
          context: normalized.context,
          timestamp: new Date().toISOString(),
        });
      }
    );
  });
}

export function getDecisionJournal(filters = {}) {
  return new Promise((resolve, reject) => {
    let query = `SELECT * FROM decision_journal WHERE 1=1`;
    const params = [];

    if (filters.symbol) {
      query += ` AND symbol = ?`;
      params.push(filters.symbol);
    }

    if (filters.strategy) {
      query += ` AND strategy = ?`;
      params.push(filters.strategy);
    }

    if (filters.decision) {
      query += ` AND decision = ?`;
      params.push(filters.decision);
    }

    if (filters.eventType) {
      query += ` AND event_type = ?`;
      params.push(filters.eventType);
    }

    const limit = Number.parseInt(filters.limit, 10);
    query += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 100);

    db.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(
        rows.map((row) => ({
          ...row,
          context: row.context_json ? JSON.parse(row.context_json) : {},
        }))
      );
    });
  });
}

export function getHistory(filters = {}) {
  return new Promise((resolve, reject) => {
    let query = `SELECT * FROM pnl_history WHERE 1=1`;
    const params = [];
    if (filters.symbol) { query += ` AND symbol = ?`; params.push(filters.symbol); }
    if (filters.mode) { query += ` AND mode = ?`; params.push(filters.mode); }
    query += ` ORDER BY timestamp DESC`;
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

export function getMetrics() {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        COUNT(*) as totalTrades,
        SUM(CASE WHEN profit_usdt > 0 THEN 1 ELSE 0 END) as winCount,
        AVG(roe_perc) as avgRoe,
        SUM(profit_usdt) as totalProfit,
        MIN(profit_usdt) as maxDrawdownUsdt
      FROM pnl_history
    `;
    db.get(query, [], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export function getDailyPnL() {
  return new Promise((resolve, reject) => {
    // Soma o lucro das últimas 24h
    const query = `SELECT SUM(profit_usdt) as daily_profit FROM pnl_history WHERE timestamp >= date('now', '-1 day')`;
    db.get(query, [], (err, row) => {
      if (err) reject(err);
      else resolve(row.daily_profit || 0);
    });
  });
}

// ── Strategy CRUD ──────────────────────────────────────────────────────────
export function getStrategies() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM strategies ORDER BY is_active DESC, updated_at DESC`, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(r => ({ ...r, params: JSON.parse(r.params_json) })));
    });
  });
}

export function getStrategy(id) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM strategies WHERE id = ?`, [id], (err, row) => {
      if (err) reject(err);
      else resolve(row ? { ...row, params: JSON.parse(row.params_json) } : null);
    });
  });
}

export function insertStrategy({ name, source, params, symbol, timeframe, is_active, benchmark_validated, backtest_validated, benchmark_score }) {
  return new Promise((resolve, reject) => {
    // Enforce 50 strategy limit
    db.get(`SELECT COUNT(*) as cnt FROM strategies`, [], (err, row) => {
      if (err) return reject(err);
      if (row.cnt >= 50) return reject(new Error('Limite de 50 estratégias atingido. Exclua alguma antes de criar outra.'));

      const paramsJson = JSON.stringify(params);
      db.run(
        `INSERT INTO strategies (name, source, params_json, symbol, timeframe, is_active, benchmark_validated, backtest_validated, benchmark_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, source || 'manual', paramsJson, symbol || null, timeframe || null,
         is_active ? 1 : 0, benchmark_validated ? 1 : 0, backtest_validated ? 1 : 0, benchmark_score || null],
        function (err) {
          if (err) reject(err);
          else resolve({ id: this.lastID });
        }
      );
    });
  });
}

export function updateStrategy(id, fields) {
  return new Promise((resolve, reject) => {
    const sets = [];
    const vals = [];
    if (fields.name !== undefined)               { sets.push('name = ?');               vals.push(fields.name); }
    if (fields.params !== undefined)              { sets.push('params_json = ?');        vals.push(JSON.stringify(fields.params)); }
    if (fields.symbol !== undefined)              { sets.push('symbol = ?');             vals.push(fields.symbol); }
    if (fields.timeframe !== undefined)           { sets.push('timeframe = ?');          vals.push(fields.timeframe); }
    if (fields.benchmark_validated !== undefined) { sets.push('benchmark_validated = ?');vals.push(fields.benchmark_validated ? 1 : 0); }
    if (fields.backtest_validated !== undefined)  { sets.push('backtest_validated = ?'); vals.push(fields.backtest_validated ? 1 : 0); }
    if (fields.benchmark_score !== undefined)     { sets.push('benchmark_score = ?');    vals.push(fields.benchmark_score); }
    sets.push('updated_at = CURRENT_TIMESTAMP');
    vals.push(id);
    db.run(`UPDATE strategies SET ${sets.join(', ')} WHERE id = ?`, vals, function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

export function deleteStrategy(id) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM strategies WHERE id = ?`, [id], function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

export function activateStrategy(id) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Deactivate all
      db.run(`UPDATE strategies SET is_active = 0`, [], (err) => {
        if (err) return reject(err);
        // Activate the selected one
        db.run(`UPDATE strategies SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id], function (err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        });
      });
    });
  });
}

export function deactivateStrategy(id) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE strategies SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id], function (err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

export default db;
