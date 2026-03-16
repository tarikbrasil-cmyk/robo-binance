"use client";

import { 
  ArrowUpRight, 
  ArrowDownRight, 
  Clock, 
  ShieldAlert,
  MoreVertical
} from "lucide-react";

interface Position {
  symbol: string;
  side?: string;
  amount: string | number;
  entry_price: string | number;
  current_price?: number;
  unrealized_pnl: string | number;
  leverage: string | number;
}

export default function PositionsTable({ positions = [] }: { positions?: Position[] }) {
  return (
    <div className="bg-[#161a1e] border border-[#1e2329] rounded-2xl shadow-sm overflow-hidden">
      <div className="p-6 border-b border-[#1e2329] flex justify-between items-center">
        <h3 className="text-lg font-bold">Active Positions</h3>
        <span className="text-xs px-2 py-1 bg-[#1e2329] text-gray-400 rounded-md">{positions.length} Open</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#1a1e23] text-gray-400 text-xs font-bold uppercase tracking-wider">
              <th className="px-6 py-4">Instrument</th>
              <th className="px-6 py-4">Side</th>
              <th className="px-6 py-4">Quantity</th>
              <th className="px-6 py-4">Entry Price</th>
              <th className="px-6 py-4">Unrealized PnL</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1e2329]">
            {positions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-500 text-sm">
                  No active positions found
                </td>
              </tr>
            ) : (
              positions.map((pos) => {
                const amount = parseFloat(pos.amount.toString());
                const side = amount > 0 ? "BUY" : "SELL";
                const pnl = parseFloat(pos.unrealized_pnl.toString());
                
                return (
                  <tr key={pos.symbol} className="hover:bg-[#1e2329]/30 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-sm tracking-tight">{pos.symbol}</span>
                        <span className="text-[10px] text-gray-500 font-medium">ISOLATED {pos.leverage}X</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold ${
                        side === 'BUY' ? 'bg-green-400/10 text-green-400' : 'bg-red-400/10 text-red-400'
                      }`}>
                        {side}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-sm">{Math.abs(amount)}</td>
                    <td className="px-6 py-4">
                      <span className="font-mono text-xs text-gray-400">{parseFloat(pos.entry_price.toString()).toFixed(2)}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold font-mono ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} USDT
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button className="p-2 hover:bg-[#2b3139] rounded-lg text-red-400 transition-colors" title="Close Market">
                          <ShieldAlert size={16} />
                        </button>
                        <button className="p-2 hover:bg-[#2b3139] rounded-lg text-gray-400 transition-colors">
                          <MoreVertical size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
