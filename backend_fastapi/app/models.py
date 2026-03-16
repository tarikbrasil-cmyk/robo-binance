from sqlalchemy import Column, Integer, String, Boolean, Decimal, DateTime, ForeignKey, Date, Text
from sqlalchemy.orm import relationship
from .database import Base
import datetime

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    api_key_encrypted = Column(Text)
    api_secret_encrypted = Column(Text)
    created_at = Column(DateTime, DEFAULT=datetime.datetime.utcnow)

    configs = relationship("TradingConfig", back_populates="user", cascade="all, delete-orphan")
    trade_logs = relationship("TradeLog", back_populates="user", cascade="all, delete-orphan")
    daily_stats = relationship("DailyStat", back_populates="user", cascade="all, delete-orphan")

class TradingConfig(Base):
    __tablename__ = "trading_configs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    bot_mode = Column(String, DEFAULT="FUTURES")
    is_active = Column(Boolean, DEFAULT=False)
    leverage = Column(Integer, DEFAULT=10)
    tp_perc = Column(Decimal(precision=5, scale=4), DEFAULT=0.06)
    sl_perc = Column(Decimal(precision=5, scale=4), DEFAULT=0.03)
    risk_per_trade = Column(Decimal(precision=5, scale=4), DEFAULT=0.10)
    max_trades_day = Column(Integer, DEFAULT=5)
    max_drawdown = Column(Decimal(precision=5, scale=4), DEFAULT=0.12)
    updated_at = Column(DateTime, DEFAULT=datetime.datetime.utcnow, ONUPDATE=datetime.datetime.utcnow)

    user = relationship("User", back_populates="configs")

class TradeLog(Base):
    __tablename__ = "trade_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    symbol = Column(String, nullable=False)
    side = Column(String, nullable=False)
    entry_price = Column(Decimal(precision=20, scale=8))
    exit_price = Column(Decimal(precision=20, scale=8))
    quantity = Column(Decimal(precision=20, scale=8))
    pnl_perc = Column(Decimal(precision=10, scale=4))
    pnl_absolute = Column(Decimal(precision=20, scale=8))
    exit_reason = Column(String)
    opened_at = Column(DateTime, DEFAULT=datetime.datetime.utcnow)
    closed_at = Column(DateTime)

    user = relationship("User", back_populates="trade_logs")

class DailyStat(Base):
    __tablename__ = "daily_stats"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    date = Column(Date, nullable=False)
    equity = Column(Decimal(precision=20, scale=8))
    pnl_daily = Column(Decimal(precision=20, scale=8))
    win_rate = Column(Decimal(precision=5, scale=4))

    user = relationship("User", back_populates="daily_stats")
