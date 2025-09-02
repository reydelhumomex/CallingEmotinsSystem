export function buildIceConfig(): RTCConfiguration {
  // Keep Chrome recommendations: <= 2 server entries (1 STUN + 1 TURN)
  // Prefer a vendor STUN first for stickiness (Metered/OpenRelay), then Google.
  const defaultStunsAll: string[] = [
    'stun:openrelay.metered.ca:80',
    // Removed Google STUN by default per user request
    // 'stun:stun.l.google.com:19302',
  ];

  const turnUrlsEnv = (process.env.NEXT_PUBLIC_TURN_URL || '').trim();
  const turnCredsUrl = (process.env.NEXT_PUBLIC_TURN_CREDENTIALS_URL || '').trim();
  const disableStunFlag = String(process.env.NEXT_PUBLIC_DISABLE_STUN || '').toLowerCase();
  let turnHost = (process.env.NEXT_PUBLIC_TURN_HOST || '').trim();
  let turnUser = (process.env.NEXT_PUBLIC_TURN_USERNAME || '').trim();
  let turnCred = (process.env.NEXT_PUBLIC_TURN_CREDENTIAL || '').trim();

  const validateTurn = (u: string) => {
    const s = u.trim();
    if (!s) return null;
    // Accept broader forms, e.g. turn:user@host:port?transport=tcp and extra query params
    const m = s.match(/^(turns?):(.+)$/i);
    if (!m) {
      // Extremely tolerant fallback: if it looks like a TURN URI, accept as-is
      if (/^turns?:/i.test(s)) return s;
      return null;
    }
    const scheme = m[1].toLowerCase();
    let rest = m[2].trim();

    // Strip embedded credentials if present (user[:pass]@)
    const atIdx = rest.lastIndexOf('@');
    if (atIdx !== -1) rest = rest.slice(atIdx + 1);

    // Separate query string
    let hostport = rest;
    let query = '';
    const qIdx = rest.indexOf('?');
    if (qIdx !== -1) {
      hostport = rest.slice(0, qIdx);
      query = rest.slice(qIdx + 1);
    }

    // Extract transport if present (ignore other params)
    let transport = '';
    if (query) {
      const pairs = query.split(/[&;]/);
      for (const p of pairs) {
        const [k, v] = p.split('=');
        if ((k || '').toLowerCase() === 'transport' && v) {
          const t = v.trim().toLowerCase();
          if (t === 'udp' || t === 'tcp') { transport = t; break; }
        }
      }
    }

    // Parse host and port (support IPv6 [::1])
    let host = '';
    let portStr = '';
    if (hostport.startsWith('[')) {
      const end = hostport.indexOf(']');
      if (end === -1) return null;
      host = hostport.slice(0, end + 1);
      if (hostport.length > end + 1 && hostport[end + 1] === ':') {
        portStr = hostport.slice(end + 2);
      }
    } else {
      const parts = hostport.split(':');
      if (parts.length > 1) {
        portStr = parts.pop() as string;
        host = parts.join(':');
      } else {
        host = hostport;
      }
    }

    const port = portStr ? Number(portStr) : (scheme === 'turns' ? 5349 : 3478);
    if (!(port > 0 && port < 65536)) return null;
    if (!host || /\s/.test(host)) return null;

    return `${scheme}:${host}:${port}${transport ? `?transport=${transport}` : ''}`;
  };

  let turnUrls: string[] = [];
  if (turnUrlsEnv) {
    const raw = turnUrlsEnv.split(/[\s,]+/).filter(Boolean);
    turnUrls = raw.map((u) => validateTurn(String(u))).filter(Boolean) as string[];
    if (!turnUrls.length && raw.length) {
      try { console.warn('[ICE] No valid TURN URLs parsed from NEXT_PUBLIC_TURN_URL. Check format.'); } catch {}
    }
  } else if (turnHost) {
    // Prioritize one UDP and one TLS for best coverage
    turnUrls = [
      `turn:${turnHost}:3478?transport=udp`,
      `turns:${turnHost}:443?transport=tcp`,
    ];
  } else {
    // Default to Metered OpenRelay if no TURN is configured
    // If user provided a credentials endpoint, we won't inject OpenRelay defaults here;
    // the async loader will fetch the real TURN servers. Keep TURN empty in this branch.
    if (!turnCredsUrl) {
      turnHost = 'openrelay.metered.ca';
      turnUser = turnUser || 'openrelayproject';
      turnCred = turnCred || 'openrelayproject';
      turnUrls = [
        `turn:${turnHost}:3478?transport=udp`,
        `turns:${turnHost}:443?transport=tcp`,
      ];
    }
  }
  // Keep all provided TURN URLs; Chrome's warning is about server entries, not URLs per entry.
  // We keep 1 STUN entry and 1 TURN entry, each may include multiple URLs.

  const servers: RTCIceServer[] = [];
  const disableStun = (disableStunFlag === '1' || disableStunFlag === 'true' || disableStunFlag === 'yes');
  const stunUrls: string[] = disableStun ? [] : defaultStunsAll;
  if (stunUrls.length) servers.push({ urls: stunUrls }); // one STUN server entry
  if (turnUrls.length) {
    servers.push({ urls: turnUrls, username: turnUser || undefined, credential: turnCred || undefined });
  }

  const cfg: RTCConfiguration = { iceServers: servers };
  // Optional debug
  try {
    const dbg = String(process.env.NEXT_PUBLIC_DEBUG_ICE || '').toLowerCase();
    if (dbg === '1' || dbg === 'true') {
      console.log('[ICE] Configured servers:', JSON.parse(JSON.stringify(servers)));
    }
  } catch {}
  // Force relay only if explicitly requested via env
  // Set NEXT_PUBLIC_FORCE_TURN=true in Vercel to force TURN relay.
  const forceTurn = String(process.env.NEXT_PUBLIC_FORCE_TURN || '').toLowerCase();
  if (forceTurn === '1' || forceTurn === 'true' || forceTurn === 'yes') {
    (cfg as any).iceTransportPolicy = 'relay';
  }
  return cfg;
}

// Async loader that prefers a credentials endpoint when provided.
// Set NEXT_PUBLIC_TURN_CREDENTIALS_URL to your Metered credentials endpoint, e.g.:
//   https://classemotionanalisis.metered.live/api/v1/turn/credentials?apiKey=... (or the URL your dashboard shows)
export async function loadIceConfig(): Promise<RTCConfiguration> {
  const dbg = (...a: any[]) => { try { const d = String(process.env.NEXT_PUBLIC_DEBUG_ICE || '').toLowerCase(); if (d === '1' || d === 'true') console.log('[ICE]', ...a); } catch {} };
  const credUrl = (process.env.NEXT_PUBLIC_TURN_CREDENTIALS_URL || '').trim();
  const disableStunFlag = String(process.env.NEXT_PUBLIC_DISABLE_STUN || '').toLowerCase();
  if (!credUrl) return buildIceConfig();

  const defaultStuns: string[] = (disableStunFlag === '1' || disableStunFlag === 'true' || disableStunFlag === 'yes')
    ? []
    : ['stun:openrelay.metered.ca:80'];

  const validateTurn = (u: string) => {
    const s = String(u || '').trim();
    if (!s) return null;
    const m = s.match(/^(turns?):(.+)$/i);
    if (!m) return null;
    const scheme = m[1].toLowerCase();
    let rest = m[2].trim();
    const atIdx = rest.lastIndexOf('@');
    if (atIdx !== -1) rest = rest.slice(atIdx + 1);
    let hostport = rest; let query = '';
    const qIdx = rest.indexOf('?');
    if (qIdx !== -1) { hostport = rest.slice(0, qIdx); query = rest.slice(qIdx + 1); }
    let transport = '';
    if (query) {
      for (const p of query.split(/[&;]/)) {
        const [k, v] = p.split('=');
        if ((k || '').toLowerCase() === 'transport' && v) {
          const t = v.trim().toLowerCase();
          if (t === 'udp' || t === 'tcp') { transport = t; break; }
        }
      }
    }
    let host = ''; let portStr = '';
    if (hostport.startsWith('[')) {
      const end = hostport.indexOf(']'); if (end === -1) return null;
      host = hostport.slice(0, end + 1);
      if (hostport.length > end + 1 && hostport[end + 1] === ':') portStr = hostport.slice(end + 2);
    } else {
      const parts = hostport.split(':');
      if (parts.length > 1) { portStr = parts.pop() as string; host = parts.join(':'); }
      else { host = hostport; }
    }
    const port = portStr ? Number(portStr) : (scheme === 'turns' ? 5349 : 3478);
    if (!(port > 0 && port < 65536)) return null;
    if (!host || /\s/.test(host)) return null;
    return `${scheme}:${host}:${port}${transport ? `?transport=${transport}` : ''}`;
  };

  try {
    const res = await fetch(credUrl, { cache: 'no-store' as any });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any = await res.json();
    // Accept both shapes: { iceServers: [...] } OR { username, credential, urls|uris: [] }
    const servers: RTCIceServer[] = [];
    if (defaultStuns.length) servers.push({ urls: defaultStuns });
    if (Array.isArray(data?.iceServers) && data.iceServers.length) {
      // Filter to TURN entries and collapse into one server where possible
      const turnEntries: RTCIceServer[] = [];
      for (const s of data.iceServers) {
        const urls = ([] as string[]).concat(s.urls || s.uris || []).filter(Boolean);
        const hasTurn = urls.some((u) => /^turns?:/i.test(String(u)));
        if (!hasTurn) continue;
        // Some providers use 'password' key instead of 'credential'
        const cred = s.credential ?? s.password;
        turnEntries.push({ urls, username: s.username, credential: cred } as any);
      }
      if (turnEntries.length) {
        // Merge all urls into one creds pair (prefer first creds)
        const allUrls = turnEntries.flatMap((e) => ([] as string[]).concat(e.urls as any)).map(String);
        const valid = allUrls.map(validateTurn).filter(Boolean) as string[];
        if (valid.length) {
          servers.push({ urls: valid, username: turnEntries[0].username, credential: (turnEntries[0] as any).credential });
        }
      }
    } else {
      const urls = ([] as string[]).concat(data?.urls || data?.uris || []).map(String);
      const valid = urls.map(validateTurn).filter(Boolean) as string[];
      const cred = data?.credential ?? data?.password;
      if (valid.length && (data?.username || cred)) {
        servers.push({ urls: valid, username: data.username, credential: cred });
      }
    }
    const cfg: RTCConfiguration = { iceServers: servers };
    const forceTurn = String(process.env.NEXT_PUBLIC_FORCE_TURN || '').toLowerCase();
    if (forceTurn === '1' || forceTurn === 'true' || forceTurn === 'yes') (cfg as any).iceTransportPolicy = 'relay';
    dbg('Loaded TURN via credentials endpoint', { endpoint: credUrl, servers: servers.map(s => ({ urls: s.urls, hasUser: !!s.username, hasCred: !!s.credential })) });
    return cfg;
  } catch (e: any) {
    dbg('Failed to load TURN credentials from endpoint; falling back to static env', e?.message || e);
    return buildIceConfig();
  }
}
