-- Database Schema for SaaS Trading Platform

-- Users and Authentication
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    api_key_encrypted TEXT,
    api_secret_encrypted TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Strategy Configuration
CREATE TABLE trading_configs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    bot_mode VARCHAR(20) DEFAULT 'FUTURES', -- SPOT or FUTURES
    is_active BOOLEAN DEFAULT FALSE,
    leverage INTEGER DEFAULT 10,
    tp_perc DECIMAL(5, 4) DEFAULT 0.06,
    sl_perc DECIMAL(5, 4) DEFAULT 0.03,
    risk_per_trade DECIMAL(5, 4) DEFAULT 0.10,
    max_trades_day INTEGER DEFAULT 5,
    max_drawdown DECIMAL(5, 4) DEFAULT 0.12,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Trade History
CREATE TABLE trade_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL, -- BUY, SELL
    entry_price DECIMAL(20, 8),
    exit_price DECIMAL(20, 8),
    quantity DECIMAL(20, 8),
    pnl_perc DECIMAL(10, 4),
    pnl_absolute DECIMAL(20, 8),
    exit_reason VARCHAR(50),
    opened_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP WITH TIME ZONE
);

-- Daily Statistics
CREATE TABLE daily_stats (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    equity DECIMAL(20, 8),
    pnl_daily DECIMAL(20, 8),
    win_rate DECIMAL(5, 4),
    UNIQUE(user_id, date)
);
