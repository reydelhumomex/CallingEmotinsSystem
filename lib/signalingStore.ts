export type SignalType = 'offer' | 'answer' | 'candidate' | 'bye';

export interface SignalMessage {
  id: number;
  from: string;
  type: SignalType;
  payload: any;
  ts: number;
}

export interface Room {
  id: string;
  createdAt: number;
  messages: SignalMessage[];
  participants: Set<string>;
  classId?: string;
  createdBy?: string; // email
}

const g = globalThis as any;
type Store = { rooms: Map<string, Room>; nextMsgId: number };
const store: Store = g.__CLASSENSE_SIGNALING || (g.__CLASSENSE_SIGNALING = { rooms: new Map<string, Room>(), nextMsgId: 1 });

export function createRoom(id: string, meta?: { classId?: string; createdBy?: string }): Room {
  let room = store.rooms.get(id);
  if (!room) {
    room = {
      id,
      createdAt: Date.now(),
      messages: [],
      participants: new Set<string>(),
      classId: meta?.classId,
      createdBy: meta?.createdBy,
    };
    store.rooms.set(id, room);
  }
  return room;
}

export function getRoom(id: string): Room | undefined {
  return store.rooms.get(id);
}

export function ensureRoom(id: string): Room {
  return createRoom(id);
}

export function addParticipant(roomId: string, peerId: string) {
  const room = ensureRoom(roomId);
  room.participants.add(peerId);
  return room;
}

export function removeParticipant(roomId: string, peerId: string) {
  const room = getRoom(roomId);
  if (room) {
    room.participants.delete(peerId);
    if (room.participants.size === 0 && room.messages.length > 2000) {
      // cleanup policy placeholder
      store.rooms.delete(roomId);
    }
  }
}

export function postMessage(roomId: string, from: string, type: SignalType, payload: any): SignalMessage {
  const room = ensureRoom(roomId);
  const msg: SignalMessage = { id: store.nextMsgId++, from, type, payload, ts: Date.now() };
  room.messages.push(msg);
  // Keep only last N messages to bound memory
  if (room.messages.length > 5000) {
    room.messages.splice(0, room.messages.length - 5000);
  }
  return msg;
}

export function getMessagesSince(roomId: string, sinceId: number = 0, excludeFrom?: string): { messages: SignalMessage[]; lastId: number } {
  const room = ensureRoom(roomId);
  const startIdx = room.messages.findIndex(m => m.id > sinceId);
  const msgs = (startIdx === -1 ? [] : room.messages.slice(startIdx)).filter(m => (excludeFrom ? m.from !== excludeFrom : true));
  const lastId = room.messages.length ? room.messages[room.messages.length - 1].id : sinceId;
  return { messages: msgs, lastId };
}

export function listRoomsByClassId(classId: string): Array<Pick<Room, 'id' | 'createdAt' | 'classId' | 'createdBy'>> {
  const out: Array<Pick<Room, 'id' | 'createdAt' | 'classId' | 'createdBy'>> = [];
  store.rooms.forEach((room) => {
    if (room.classId === classId) {
      out.push({ id: room.id, createdAt: room.createdAt, classId: room.classId, createdBy: room.createdBy });
    }
  });
  // sort newest first
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}
