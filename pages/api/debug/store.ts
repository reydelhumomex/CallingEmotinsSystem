import type { NextApiRequest, NextApiResponse } from 'next';
import { getStoreMode } from '../../../lib/signalingStore';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, mode: getStoreMode() });
}

