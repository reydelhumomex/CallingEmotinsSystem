import type { NextApiRequest, NextApiResponse } from 'next';
import { buildIceConfig, loadIceConfig } from '../../../lib/ice';

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  let cfg: RTCConfiguration = buildIceConfig();
  try { cfg = await loadIceConfig(); } catch {}
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
