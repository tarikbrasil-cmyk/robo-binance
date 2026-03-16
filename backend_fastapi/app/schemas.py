from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime
from decimal import Decimal

# User Schemas
class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    password: str

class User(UserBase):
    id: int
    created_at: datetime

    class Config:
        orm_mode = True

# Trading Config Schemas
class TradingConfigBase(BaseModel):
    bot_mode: str = "FUTURES"
    is_active: bool = False
    leverage: int = 10
    tp_perc: Decimal = Decimal("0.06")
    sl_perc: Decimal = Decimal("0.03")
    risk_per_trade: Decimal = Decimal("0.10")
    max_trades_day: int = 5
    max_drawdown: Decimal = Decimal("0.12")

class TradingConfigUpdate(TradingConfigBase):
    pass

class TradingConfig(TradingConfigBase):
    id: int
    user_id: int
    updated_at: datetime

    class Config:
        orm_mode = True

# Trade Log Schemas
class TradeLogBase(BaseModel):
    symbol: str
    side: str
    entry_price: Decimal
    quantity: Decimal

class TradeLog(TradeLogBase):
    id: int
    user_id: int
    exit_price: Optional[Decimal]
    pnl_perc: Optional[Decimal]
    pnl_absolute: Optional[Decimal]
    exit_reason: Optional[str]
    opened_at: datetime
    closed_at: Optional[datetime]

    class Config:
        orm_mode = True
