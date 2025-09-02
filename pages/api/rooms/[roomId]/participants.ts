import type { NextApiRequest, NextApiResponse } from 'next';
import { getActiveParticipants, getRoom, heartbeat } from '../../../../lib/signalingStore';
import { getUserFromRequest } from '../../../../lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'POST'].includes(req.method || '')) {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end('Method Not Allowed');
  }
  res.setHeader('Cache-Control', 'no-store');
  const { roomId } = req.query as { roomId: string };
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const room = await getRoom(roomId);
  if (!room) return res.status(200).json({ ok: true, participants: [] });
  if (room.classId && room.classId !== user.classId) return res.status(403).json({ ok: false, error: 'Forbidden' });
  if (req.method === 'POST') {
    try { await heartbeat(roomId, String(req.body?.peerId || '')); } catch {}
  }
  const participants = await getActiveParticipants(roomId);
  return res.status(200).json({ ok: true, participants });
}
export const config = { runtime: 'nodejs' };
