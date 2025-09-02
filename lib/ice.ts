export function buildIceConfig(): RTCConfiguration {
  // Keep Chrome recommendations: <= 2 server entries (1 STUN + 1 TURN)
  const stunUrls: string[] = [
    'stun:stun.l.google.com:19302',
    'stun:global.stun.twilio.com:3478',
  ];

  const turnUrlsEnv = (process.env.NEXT_PUBLIC_TURN_URL || '').trim();
  const turnHost = (process.env.NEXT_PUBLIC_TURN_HOST || '').trim();
  const turnUser = (process.env.NEXT_PUBLIC_TURN_USERNAME || '').trim();
  const turnCred = (process.env.NEXT_PUBLIC_TURN_CREDENTIAL || '').trim();
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
  }
  // Limit to 2 urls max to avoid Chrome warnings
  if (turnUrls.length > 2) turnUrls = turnUrls.slice(0, 2);

  const servers: RTCIceServer[] = [];
  servers.push({ urls: stunUrls }); // one STUN server entry
  if (turnUrls.length) {
    servers.push({ urls: turnUrls, username: turnUser || undefined, credential: turnCred || undefined });
  }

  const cfg: RTCConfiguration = { iceServers: servers };
  if (forceTurn === '1' || forceTurn === 'true' || forceTurn === 'yes') {
    (cfg as any).iceTransportPolicy = 'relay';
  }
  return cfg;
}

