import json
import redis
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

app = FastAPI(title="QuantSaaS Control API")

# Redis for Inter-Process Communication (IPC)
# Ensure decoding is enabled for easier string handling
r = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SetupRequest(BaseModel):
    apiKey: str
    apiSecret: str
    leverage: int
    mode: str

@app.get("/health")
async def health_check():
    engine_running = r.get("bot:running") == "true"
    return {
        "status": "online",
        "engine": "active" if engine_running else "standby",
        "bot_running": engine_running
    }

@app.post("/bot/start")
async def start_bot():
    r.set("bot:running", "true")
    r.publish("bot:commands", "START")
    print("🚀 [API] Start signal broadcasted")
    return {"message": "Start signal sent to Trading Engine"}

@app.post("/bot/stop")
async def stop_bot():
    r.set("bot:running", "false")
    r.publish("bot:commands", "STOP")
    print("🛑 [API] Stop signal broadcasted")
    return {"message": "Stop signal sent to Trading Engine"}

@app.get("/positions")
async def get_positions():
    pos_data = r.get("bot:active_positions")
    return json.loads(pos_data) if pos_data else []

@app.get("/pnl")
async def get_pnl():
    return {"daily_pnl": r.get("bot:daily_pnl") or 0}

@app.get("/opportunities")
async def get_opportunities():
    opp_data = r.get("bot:opportunities")
    return json.loads(opp_data) if opp_data else []

@app.post("/user/setup")
async def user_setup(data: SetupRequest):
    r.set("config:binance_api_key", data.apiKey)
    r.set("config:binance_api_secret", data.apiSecret)
    r.set("config:default_leverage", str(data.leverage))
    r.set("config:trading_mode", data.mode)
    return {"status": "success", "message": "Configuration saved to control layer"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
