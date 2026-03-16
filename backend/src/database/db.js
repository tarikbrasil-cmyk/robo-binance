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
