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

export default db;
