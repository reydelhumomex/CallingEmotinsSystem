export type SignalType = 'offer' | 'answer' | 'candidate' | 'bye';

export interface SignalMessage {
  id: number;
  from: string;
  to?: string; // optional recipient peerId; undefined = broadcast to room
  type: SignalType;
  payload: any;
  ts: number;
}

export interface RoomMeta {
  id: string;
  createdAt: number;
  classId?: string;
  createdBy?: string; // email
}

// Optional Redis (Vercel KV/Upstash) backing. Falls back to in-memory store for dev.
let useRedis = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
type UpstashRedis = any;
let redis: UpstashRedis | null = null;
if (useRedis) {
  try {
    // Lazy require to avoid type dependency in builds without KV
    const { Redis } = require('@upstash/redis');
    redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  } catch (e) {
    // If the package is missing, fall back to memory
    useRedis = false;
    redis = null;
  }
}

// In-memory fallback store (works in dev and single-process prod)
type MemRoom = RoomMeta & { messages: SignalMessage[]; participants: Set<string> };
const g = globalThis as any;
type MemStore = { rooms: Map<string, MemRoom>; nextMsgId: number; presence: Map<string, Map<string, number>> };
const mem: MemStore = g.__CLASSENSE_SIGNALING || (g.__CLASSENSE_SIGNALING = { rooms: new Map<string, MemRoom>(), nextMsgId: 1, presence: new Map() });
// Backward‑compat for dev HMR: older shape may lack presence
if (!(mem as any).presence || !((mem as any).presence instanceof Map)) {
  (mem as any).presence = new Map();
}

// Key helpers for Redis
function kRoom(id: string) { return `room:${id}`; }
function kParticipants(id: string) { return `room:${id}:participants`; }
function kMessages(id: string) { return `room:${id}:messages`; }
function kMsgSeq(id: string) { return `room:${id}:msg_id`; }
function kClassIdx(classId: string) { return `class:${classId}:rooms`; }
function kPresence(id: string) { return `room:${id}:presence`; }

export async function createRoom(id: string, meta?: { classId?: string; createdBy?: string }): Promise<RoomMeta> {
  if (useRedis && redis) {
    const now = Date.now();
    const existing = await redis.get(kRoom(id));
    if (existing) return existing as RoomMeta;
    const room: RoomMeta = { id, createdAt: now, classId: meta?.classId, createdBy: meta?.createdBy };
    await redis.set(kRoom(id), room);
    if (room.classId) {
      await redis.zadd(kClassIdx(room.classId), { score: room.createdAt, member: room.id });
    }
    return room;
  }
  let room = mem.rooms.get(id);
  if (!room) {
    room = { id, createdAt: Date.now(), messages: [], participants: new Set<string>(), classId: meta?.classId, createdBy: meta?.createdBy };
    mem.rooms.set(id, room);
  }
  return room;
}

export async function getRoom(id: string): Promise<RoomMeta | undefined> {
  if (useRedis && redis) {
    const meta = await redis.get(kRoom(id));
    return (meta || undefined) as RoomMeta | undefined;
  }
  return mem.rooms.get(id);
}

export async function ensureRoom(id: string, meta?: { classId?: string; createdBy?: string }): Promise<RoomMeta> {
  const room = await getRoom(id);
  if (room) return room;
  return createRoom(id, meta);
}

export async function addParticipant(roomId: string, peerId: string, meta?: { classId?: string; createdBy?: string }) {
  if (useRedis && redis) {
    await ensureRoom(roomId, meta);
    await redis.sadd(kParticipants(roomId), peerId);
    // Initialize presence on add
    const now = Date.now();
    await redis.zadd(kPresence(roomId), { score: now, member: peerId });
    try { await redis.pexpire(kPresence(roomId), 1000 * 60 * 10); } catch {}
    return;
  }
  const room = (await ensureRoom(roomId, meta)) as MemRoom;
  (room as MemRoom).participants.add(peerId);
  let p = mem.presence.get(roomId);
  if (!p) { p = new Map(); mem.presence.set(roomId, p); }
  p.set(peerId, Date.now());
}

export async function getParticipants(roomId: string): Promise<string[]> {
  if (useRedis && redis) {
    const list = await redis.smembers(kParticipants(roomId));
    return (list || []) as string[];
  }
  const room = mem.rooms.get(roomId) as MemRoom | undefined;
  return room ? Array.from(room.participants) : [];
}

export async function removeParticipant(roomId: string, peerId: string) {
  if (useRedis && redis) {
    await redis.srem(kParticipants(roomId), peerId);
    try { await redis.zrem(kPresence(roomId), peerId); } catch {}
    return;
  }
  const room = mem.rooms.get(roomId) as MemRoom | undefined;
  if (room) {
    room.participants.delete(peerId);
    if (room.participants.size === 0 && room.messages.length > 2000) {
      mem.rooms.delete(roomId);
    }
  }
  const p = mem.presence.get(roomId);
  p?.delete(peerId);
}

export async function postMessage(roomId: string, from: string, type: SignalType, payload: any, to?: string): Promise<SignalMessage> {
  if (useRedis && redis) {
    await ensureRoom(roomId);
    const id = await redis.incr(kMsgSeq(roomId));
    const msg: SignalMessage = { id, from, to, type, payload, ts: Date.now() };
    await redis.zadd(kMessages(roomId), { score: id, member: JSON.stringify(msg) });
    // Optional trim: keep last 5000 by id window (no-op for small demos)
    return msg;
  }
  const room = (await ensureRoom(roomId)) as MemRoom;
  const msg: SignalMessage = { id: mem.nextMsgId++, from, to, type, payload, ts: Date.now() };
  room.messages.push(msg);
  if (room.messages.length > 5000) {
    room.messages.splice(0, room.messages.length - 5000);
  }
  return msg;
}

export async function getMessagesSince(roomId: string, sinceId: number = 0, excludeFrom?: string): Promise<{ messages: SignalMessage[]; lastId: number }> {
  if (useRedis && redis) {
    await ensureRoom(roomId);
    const raw = (await redis.zrange(kMessages(roomId), sinceId + 0.000001, '+inf', { byScore: true })) as string[];
    const messages: SignalMessage[] = (raw || []).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
    const filtered = excludeFrom ? messages.filter((m) => m.from !== excludeFrom) : messages;
    const lastId = filtered.length ? filtered[filtered.length - 1].id : sinceId;
    return { messages: filtered, lastId };
  }
  const room = (await ensureRoom(roomId)) as MemRoom;
  const startIdx = room.messages.findIndex(m => m.id > sinceId);
  const msgs = (startIdx === -1 ? [] : room.messages.slice(startIdx)).filter(m => (excludeFrom ? m.from !== excludeFrom : true));
  const lastId = room.messages.length ? room.messages[room.messages.length - 1].id : sinceId;
  return { messages: msgs, lastId };
}

export async function listRoomsByClassId(classId: string): Promise<Array<Pick<RoomMeta, 'id' | 'createdAt' | 'classId' | 'createdBy'>>> {
  if (useRedis && redis) {
    const entries = await redis.zrange(kClassIdx(classId), 0, -1, { withScores: true });
    // zrange returns alternating [member, score, member, score...]
    const out: Array<Pick<RoomMeta, 'id' | 'createdAt' | 'classId' | 'createdBy'>> = [];
    for (let i = 0; i < entries.length; i += 2) {
      const id = entries[i] as string;
      const createdAt = Number(entries[i + 1]);
      const meta = (await redis.get(kRoom(id))) as RoomMeta | null;
      out.push({ id, createdAt, classId: meta?.classId, createdBy: meta?.createdBy });
    }
    // Already sorted ascending by score; reverse for newest first
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }
  const out: Array<Pick<RoomMeta, 'id' | 'createdAt' | 'classId' | 'createdBy'>> = [];
  mem.rooms.forEach((room) => {
    if (room.classId === classId) {
      out.push({ id: room.id, createdAt: room.createdAt, classId: room.classId, createdBy: room.createdBy });
    }
  });
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

export function getStoreMode(): 'redis' | 'memory' {
  return useRedis ? 'redis' : 'memory';
}

// Presence (rejoin/resilience)
export async function heartbeat(roomId: string, peerId: string) {
  const now = Date.now();
  if (useRedis && redis) {
    await ensureRoom(roomId);
    await redis.zadd(kPresence(roomId), { score: now, member: peerId });
    try { await redis.pexpire(kPresence(roomId), 1000 * 60 * 10); } catch {}
    return;
  }
  let p = mem.presence.get(roomId);
  if (!p) { p = new Map(); mem.presence.set(roomId, p); }
  p.set(peerId, now);
}

export async function getActiveParticipants(roomId: string, windowMs: number = 15000): Promise<string[]> {
  const cutoff = Date.now() - windowMs;
  if (useRedis && redis) {
    try {
      const list = await redis.zrange(kPresence(roomId), cutoff, '+inf', { byScore: true });
      return (list || []) as string[];
    } catch {
      // Fallback to full set if server doesn't support byScore
      return getParticipants(roomId);
    }
  }
  const p = mem.presence.get(roomId);
  if (!p) return [];
  const out: string[] = [];
  p.forEach((ts, id) => { if (ts >= cutoff) out.push(id); });
  return out;
}
