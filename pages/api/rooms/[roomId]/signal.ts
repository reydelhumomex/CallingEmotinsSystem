import type { NextApiRequest, NextApiResponse } from 'next';
import { getMessagesSince, postMessage, getRoom, createRoom } from '../../../../lib/signalingStore';
import { getUserFromRequest } from '../../../../lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { roomId } = req.query as { roomId: string };
  const user = getUserFromRequest(req);
  if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  let room = await getRoom(roomId);
  if (!room) {
    // Auto-create if missing to support stateless/serverless instances
    room = await createRoom(roomId, { classId: user.classId, createdBy: user.email });
  }
  if (room.classId && room.classId !== user.classId) return res.status(403).json({ ok: false, error: 'Forbidden' });

  if (req.method === 'GET') {
    const sinceId = Number(req.query.since || 0);
    const excludeFrom = (req.query.excludeFrom as string) || undefined;
    const { messages, lastId } = await getMessagesSince(roomId, sinceId, excludeFrom);
    return res.status(200).json({ ok: true, messages, lastId });
  }

  if (req.method === 'POST') {
    const { from, type, payload } = req.body || {};
    if (!from || !type) return res.status(400).json({ ok: false, error: 'Missing fields' });
    const msg = await postMessage(roomId, String(from), String(type) as any, payload);
    return res.status(200).json({ ok: true, id: msg.id });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end('Method Not Allowed');
}
