import type { NextApiRequest, NextApiResponse } from 'next';

// Server-side proxy to fetch Metered TURN credentials.
// Configure in Vercel:
// - TURN_CREDENTIALS_URL=https://<your-subdomain>.metered.live/api/v1/turn/credentials?apiKey=...

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const upstream = process.env.TURN_CREDENTIALS_URL || '';
  if (!upstream) {
    return res.status(400).json({ ok: false, error: 'TURN_CREDENTIALS_URL not configured' });
  }
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 7000);
    const r = await fetch(upstream, { signal: ac.signal });
    clearTimeout(t);
    const txt = await r.text();
    if (!r.ok) {
      return res.status(r.status).json({ ok: false, error: `Upstream ${r.status}`, body: txt.slice(0, 2000) });
    }
    // Try to normalize into { iceServers: [...] }
    let data: any = {};
    try { data = JSON.parse(txt); } catch { data = {}; }
    if (Array.isArray(data?.iceServers)) {
      // pass-through
      return res.status(200).json({ ok: true, iceServers: data.iceServers });
    }
    const urls = ([] as string[]).concat(data?.urls || data?.uris || []).filter(Boolean);
    if (urls.length && (data?.username || data?.credential || data?.password)) {
      return res.status(200).json({ ok: true, iceServers: [{ urls, username: data.username, credential: data.credential ?? data.password }] });
    }
    return res.status(200).json({ ok: true, iceServers: [] });
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? 'Timeout fetching TURN credentials' : (e?.message || String(e));
    return res.status(502).json({ ok: false, error: msg });
  }
}

export const config = { runtime: 'nodejs' };

