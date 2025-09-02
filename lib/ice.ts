export function buildIceConfig(): RTCConfiguration {
  // Keep Chrome recommendations: <= 2 server entries (1 STUN + 1 TURN)
  // Prefer a vendor STUN first for stickiness (Metered/OpenRelay), then Google.
  const defaultStuns: string[] = [
    'stun:openrelay.metered.ca:80',
    'stun:stun.l.google.com:19302',
  ];

  const turnUrlsEnv = (process.env.NEXT_PUBLIC_TURN_URL || '').trim();
  let turnHost = (process.env.NEXT_PUBLIC_TURN_HOST || '').trim();
  let turnUser = (process.env.NEXT_PUBLIC_TURN_USERNAME || '').trim();
  let turnCred = (process.env.NEXT_PUBLIC_TURN_CREDENTIAL || '').trim();

  const validateTurn = (u: string) => {
    const s = u.trim();
    if (!s) return null;
    // Accept broader forms, e.g. turn:user@host:port?transport=tcp and extra query params
    const m = s.match(/^(turns?):(.+)$/i);
    if (!m) return null;
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
    turnUrls = raw.map(validateTurn).filter(Boolean) as string[];
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
    turnHost = 'openrelay.metered.ca';
    turnUser = turnUser || 'openrelayproject';
    turnCred = turnCred || 'openrelayproject';
    turnUrls = [
      `turn:${turnHost}:3478?transport=udp`,
      `turns:${turnHost}:443?transport=tcp`,
    ];
  }
  // Limit to 2 urls max to avoid Chrome warnings
  if (turnUrls.length > 2) turnUrls = turnUrls.slice(0, 2);

  const servers: RTCIceServer[] = [];
  const stunUrls: string[] = defaultStuns;
  servers.push({ urls: stunUrls }); // one STUN server entry
  if (turnUrls.length) {
    servers.push({ urls: turnUrls, username: turnUser || undefined, credential: turnCred || undefined });
  }

  const cfg: RTCConfiguration = { iceServers: servers };
  // Force relay only if explicitly requested via env
  // Set NEXT_PUBLIC_FORCE_TURN=true in Vercel to force TURN relay.
  const forceTurn = String(process.env.NEXT_PUBLIC_FORCE_TURN || '').toLowerCase();
  if (forceTurn === '1' || forceTurn === 'true' || forceTurn === 'yes') {
    (cfg as any).iceTransportPolicy = 'relay';
  }
  return cfg;
}
