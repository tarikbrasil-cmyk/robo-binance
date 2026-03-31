import { insertDecisionEntry } from '../database/db.js';
import { broadcastMessage } from '../utils/websocket.js';

function sanitizeContext(context = {}) {
  try {
    return JSON.parse(JSON.stringify(context));
  } catch {
    return { note: 'context_serialization_failed' };
  }
}

export async function recordDecision(entry, options = {}) {
  const normalizedEntry = {
    source: entry.source || 'SYSTEM',
    eventType: entry.eventType || 'UNKNOWN',
    decision: entry.decision || 'INFO',
    symbol: entry.symbol || null,
    side: entry.side || null,
    strategy: entry.strategy || null,
    price: Number.isFinite(entry.price) ? entry.price : null,
    reason: entry.reason || null,
    context: sanitizeContext(entry.context),
  };

  try {
    const savedEntry = await insertDecisionEntry(normalizedEntry);

    if (options.wss) {
      broadcastMessage(options.wss, 'DECISION_EVENT', savedEntry);
    }

    return savedEntry;
  } catch (error) {
    console.error(`[DECISION_JOURNAL] Failed to persist ${normalizedEntry.eventType}: ${error.message}`);
    return null;
  }
}