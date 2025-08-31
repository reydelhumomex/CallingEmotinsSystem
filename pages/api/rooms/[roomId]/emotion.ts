import type { NextApiRequest, NextApiResponse } from 'next';
import { getRoomEmotions, upsertEmotion } from '../../../../lib/emotionStore';
import { getUserFromRequest } from '../../../../lib/auth';
import { getRoom } from '../../../../lib/signalingStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { roomId } = req.query as { roomId: string };
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const room = getRoom(roomId);
  // For GET, if room is missing (e.g., dev HMR cleared memory), return empty data instead of 404
  if (req.method === 'GET' && !room) {
    const data = getRoomEmotions(roomId);
    return res.status(200).json({ ok: true, ...data });
  }
  if (!room) return res.status(404).json({ ok: false, error: 'Room not found' });
  if (room.classId && room.classId !== user.classId) return res.status(403).json({ ok: false, error: 'Forbidden' });

  if (req.method === 'GET') {
    const data = getRoomEmotions(roomId);
    return res.status(200).json({ ok: true, ...data });
  }

  if (req.method === 'POST') {
    const { peerId, name, emotions, updatedAt } = req.body || {};
    if (!peerId || !emotions) return res.status(400).json({ ok: false, error: 'Missing peerId or emotions' });
    const saved = upsertEmotion(roomId, String(peerId), { name, emotions, updatedAt });
    return res.status(200).json({ ok: true, saved });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end('Method Not Allowed');
}
