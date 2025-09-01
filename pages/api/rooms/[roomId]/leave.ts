import type { NextApiRequest, NextApiResponse } from 'next';
import { removeParticipant, getRoom } from '../../../../lib/signalingStore';
import { getUserFromRequest } from '../../../../lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end('Method Not Allowed');
  }
  res.setHeader('Cache-Control', 'no-store');
  const { roomId } = req.query as { roomId: string };
  const { peerId } = req.body || {};
  if (!peerId) return res.status(400).json({ ok: false, error: 'Missing peerId' });
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const room = await getRoom(roomId);
  if (!room) return res.status(200).json({ ok: true });
  if (room.classId && room.classId !== user.classId) return res.status(403).json({ ok: false, error: 'Forbidden' });
  try { await removeParticipant(roomId, String(peerId)); } catch {}
  return res.status(200).json({ ok: true });
}

