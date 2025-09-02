import type { NextApiRequest, NextApiResponse } from 'next';
import { buildIceConfig } from '../../../lib/ice';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  const cfg = buildIceConfig();
  const redacted = {
    iceServers: (cfg.iceServers || []).map((s: any) => ({
      urls: s.urls,
      hasUsername: Boolean(s.username),
      hasCredential: Boolean(s.credential),
    })),
    iceTransportPolicy: (cfg as any).iceTransportPolicy,
  };
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, cfg: redacted });
}
export const config = { runtime: 'nodejs' };

