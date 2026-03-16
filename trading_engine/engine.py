import asyncio
import logging
import redis
import json
from modules.market_scanner import MarketScanner
from modules.strategy_manager import StrategyManager
from modules.risk_manager import RiskManager
from modules.order_executor import OrderExecutor
from modules.position_manager import PositionManager

# Professional Logging Setup
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler("../logs/engine.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("TradingEngine")

class TradingEngine:
    def __init__(self):
        self.running = False
        self.r = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
        self.scanner = MarketScanner()
        self.strategy = StrategyManager()
        self.risk = RiskManager()
        self.executor = OrderExecutor()
        self.positions = PositionManager()
        
    async def start(self):
        logger.info("🚀 Trading Engine Initialized (Async 3-Layer)")
        await self.run_loop()
        
    async def check_commands(self):
        # Check Redis for start/stop commands
        cmd = self.r.get("bot:running")
        if cmd == "true" and not self.running:
            self.running = True
            logger.info("▶️ Bot Started via Remote Command")
        elif cmd == "false" and self.running:
            self.running = False
            logger.info("⏸️ Bot Stopped via Remote Command")

    async def run_loop(self):
        while True:
            await self.check_commands()
            
            if self.running:
                try:
                    # 1. Scan Market
                    opportunities = await self.scanner.scan()
                    
                    # 2. Strategy Analysis
                    for opp in opportunities:
                        signal = await self.strategy.analyze(opp)
                        
                        if signal:
                            # 3. Risk Check
                            if await self.risk.validate_trade(signal):
                                # 4. Execute
                                await self.executor.execute(signal)
                    
                    # 5. Position Management
                    await self.positions.update()
                    
                except Exception as e:
                    logger.error(f"❌ Engine Loop Error: {str(e)}")
                    await asyncio.sleep(5)
            
            await asyncio.sleep(1) # Engine heartbeat

if __name__ == "__main__":
    engine = TradingEngine()
    asyncio.run(engine.start())
