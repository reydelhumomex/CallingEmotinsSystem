import type { NextApiRequest, NextApiResponse } from 'next';
import { login, listMockUsers } from '../../lib/auth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    // expose mock users for the client UI
    return res.status(200).json({ ok: true, users: listMockUsers() });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end('Method Not Allowed');
  }
  const { email, classId } = req.body || {};
  if (!email || !classId) return res.status(400).json({ ok: false, message: 'Missing email/classId' });
  const user = login(String(email), String(classId));
  if (!user) return res.status(401).json({ ok: false, message: 'Invalid credentials or class ID' });
  return res.status(200).json({ ok: true, user });
}

