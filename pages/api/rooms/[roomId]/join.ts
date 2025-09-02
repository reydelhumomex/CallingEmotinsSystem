import type { NextApiRequest, NextApiResponse } from 'next';
import { addParticipant, getRoom, createRoom, getParticipants } from '../../../../lib/signalingStore';
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
  let room = await getRoom(roomId);
  if (!room) {
    // Auto-create the room on join to support stateless/serverless deploys
    room = await createRoom(roomId, { classId: user.classId, createdBy: user.email });
  }
  if (room.classId && room.classId !== user.classId) return res.status(403).json({ ok: false, error: 'Forbidden' });
  await addParticipant(roomId, peerId, { classId: user.classId, createdBy: user.email });
  const participants = await getParticipants(roomId);
  return res.status(200).json({ ok: true, participants });
}
export const config = { runtime: 'nodejs' };
