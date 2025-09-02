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
  const forceTurn = String(process.env.NEXT_PUBLIC_FORCE_TURN || '').toLowerCase();

  const validateTurn = (u: string) => {
    const s = u.trim();
    if (!s) return null;
    const m = s.match(/^(turns?):([^\s:?,]+)(?::(\d{1,5}))?(?:\?transport=(udp|tcp))?$/i);
    if (!m) return null;
    const scheme = m[1].toLowerCase();
    const host = m[2];
    const port = m[3] ? Number(m[3]) : (scheme === 'turns' ? 5349 : 3478);
    if (!(port > 0 && port < 65536)) return null;
    const transport = (m[4] || '').toLowerCase();
    return `${scheme}:${host}:${port}${transport ? `?transport=${transport}` : ''}`;
  };

  let turnUrls: string[] = [];
  if (turnUrlsEnv) {
    turnUrls = turnUrlsEnv
      .split(',')
      .map(validateTurn)
      .filter(Boolean) as string[];
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
  // Force relay to guarantee connectivity (normal + incognito on same device)
  // You can override by setting NEXT_PUBLIC_FORCE_TURN=false explicitly.
  const forceTurn = String(process.env.NEXT_PUBLIC_FORCE_TURN ?? 'true').toLowerCase();
  if (forceTurn === '1' || forceTurn === 'true' || forceTurn === 'yes') {
    (cfg as any).iceTransportPolicy = 'relay';
  }
  return cfg;
}
