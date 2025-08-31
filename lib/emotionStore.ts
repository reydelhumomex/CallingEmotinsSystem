import { EmotionDistribution, generateRecommendations, normalizeDistribution } from './emotion';

export type EmotionEntry = {
  peerId: string;
  name?: string;
  emotions: EmotionDistribution;
  updatedAt: string;
};

const rooms = new Map<string, Map<string, EmotionEntry>>(); // roomId -> (peerId -> entry)

export function upsertEmotion(roomId: string, peerId: string, entry: Omit<EmotionEntry, 'peerId' | 'updatedAt'> & { updatedAt?: string }) {
  let room = rooms.get(roomId);
  if (!room) { room = new Map(); rooms.set(roomId, room); }
  const normalized = normalizeDistribution(entry.emotions);
  const rec: EmotionEntry = {
    peerId,
    name: entry.name,
    emotions: normalized,
    updatedAt: entry.updatedAt || new Date().toISOString(),
  };
  room.set(peerId, rec);
  return rec;
}

export function getRoomEmotions(roomId: string) {
  const room = rooms.get(roomId) || new Map();
  const list = Array.from(room.values());
  const recommendations = generateRecommendations(list);
  return { students: list, recommendations };
}

