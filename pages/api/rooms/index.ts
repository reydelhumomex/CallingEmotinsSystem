import type { NextApiRequest, NextApiResponse } from 'next';
import { createRoom, getRoom, listRoomsByClassId } from '../../../lib/signalingStore';
import { getUserFromRequest } from '../../../lib/auth';

function randomId(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user || user.role !== 'teacher') {
      return res.status(403).json({ ok: false, error: 'Only teacher can create rooms' });
    }
    const id = (req.body?.id as string) || randomId();
    const room = await createRoom(id, { classId: user.classId, createdBy: user.email });
    return res.status(200).json({ ok: true, roomId: room.id });
  }
  if (req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    res.setHeader('Cache-Control', 'no-store');
    // List by classId
    const classId = String(req.query.classId || '');
    if (classId) {
      if (user.classId !== classId) return res.status(403).json({ ok: false, error: 'Forbidden' });
      const rooms = await listRoomsByClassId(classId);
      return res.status(200).json({ ok: true, rooms });
    }
    // Simple existence check by id
    const id = String(req.query.id || '');
    if (!id) return res.status(400).json({ ok: false, error: 'Missing id or classId' });
    const room = await getRoom(id);
    return res.status(200).json({ ok: true, exists: !!room });
  }
  res.setHeader('Allow', ['POST', 'GET']);
  return res.status(405).end('Method Not Allowed');
}
