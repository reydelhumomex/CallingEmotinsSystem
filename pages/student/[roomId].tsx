import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import {
  Box,
  Button,
  Container,
  Flex,
  Heading,
  HStack,
  IconButton,
  Spacer,
  Text,
  Tooltip,
  useClipboard,
  useToast,
  VStack,
  Tag,
  SimpleGrid,
} from '@chakra-ui/react';
import { CopyIcon, PhoneIcon, RepeatIcon, CloseIcon } from '@chakra-ui/icons';
import useEmotionAnalysis from '../../hooks/useEmotionAnalysis';
import ChatPanel, { type ChatMessage } from '../../components/ChatPanel';
import EmotionDonut from '../../components/EmotionDonut';
import { loadUser } from '../../lib/authClient';

type SignalType = 'offer' | 'answer' | 'candidate' | 'bye' | 'chat';

function randomPeerId() {
  return Math.random().toString(36).slice(2, 10);
}

function StudentRoomPage() {
  const router = useRouter();
  const { roomId } = router.query as { roomId: string };
  const toast = useToast();

  const [peerId] = useState(() => randomPeerId());
  const [joined, setJoined] = useState(false);
  const [connected, setConnected] = useState(false);
  const [pollCursor, setPollCursor] = useState(0);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingByPeerRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoElsRef = useRef<Record<string, HTMLVideoElement | null>>({});
  const screenStreamRef = useRef<MediaStream | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [remoteMuted, setRemoteMuted] = useState(true);
  const [chat, setChat] = useState<ChatMessage[]>([]);

  const pageUrl = typeof window !== 'undefined' ? window.location.href : '';
  const { onCopy, hasCopied } = useClipboard(pageUrl);

  const iceServers = useMemo(() => {
    const servers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ];
    const turnUrls = (process.env.NEXT_PUBLIC_TURN_URL || '').trim();
    const turnHost = (process.env.NEXT_PUBLIC_TURN_HOST || '').trim();
    const turnUser = (process.env.NEXT_PUBLIC_TURN_USERNAME || '').trim();
    const turnCred = (process.env.NEXT_PUBLIC_TURN_CREDENTIAL || '').trim();
    const forceTurn = String(process.env.NEXT_PUBLIC_FORCE_TURN || '').toLowerCase();
    const validUrls: string[] = [];
    const pushIfValid = (u: string) => {
      const s = u.trim();
      if (!s) return;
      const m = s.match(/^(turns?):([^\s:?,]+)(?::(\d{1,5}))?(?:\?transport=(udp|tcp))?$/i);
      if (!m) return;
      const scheme = m[1].toLowerCase();
      const host = m[2];
      let port = m[3] ? Number(m[3]) : (scheme === 'turns' ? 5349 : 3478);
      if (!(port > 0 && port < 65536)) return;
      const transport = (m[4] || '').toLowerCase();
      const url = `${scheme}:${host}:${port}${transport ? `?transport=${transport}` : ''}`;
      validUrls.push(url);
    };
    if (turnUrls) {
      turnUrls.split(',').forEach(pushIfValid);
    } else if (turnHost) {
      [
        `turn:${turnHost}:3478?transport=udp`,
        `turn:${turnHost}:3478?transport=tcp`,
        `turn:${turnHost}:80?transport=tcp`,
        `turns:${turnHost}:443?transport=tcp`,
        `turns:${turnHost}:5349?transport=tcp`,
      ].forEach(pushIfValid);
    }
    if (validUrls.length) {
      servers.push({ urls: validUrls, username: turnUser || undefined, credential: turnCred || undefined });
    }
    const cfg: RTCConfiguration = { iceServers: servers };
    if (forceTurn === '1' || forceTurn === 'true' || forceTurn === 'yes') (cfg as any).iceTransportPolicy = 'relay';
    return cfg as RTCConfiguration;
  }, []);

  const postSignal = useCallback(async (type: SignalType, payload: any, to?: string) => {
    const u = loadUser();
    await fetch(`/api/rooms/${roomId}/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(u ? { 'Authorization': `Bearer ${u.token}`, 'X-User-Email': u.email } : {}) },
      body: JSON.stringify({ from: peerId, type, payload, to }),
    });
  }, [peerId, roomId]);

  const authedUser = loadUser();
  const authToken = authedUser?.token;
  const authEmail = authedUser?.email;
  const [analysisEnabled, setAnalysisEnabled] = useState(false);
  const { isAnalyzing, emotions, start: startAnalysis, stop: stopAnalysis } = useEmotionAnalysis(localVideoRef, {
    fps: 3,
    onUpdate: async (em) => {
      try {
        if (authedUser) {
          await fetch(`/api/rooms/${roomId}/emotion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authedUser.token}`, 'X-User-Email': authedUser.email },
            body: JSON.stringify({ peerId, emotions: em }),
          });
        }
      } catch {}
    },
  });

  // Local media helper
  const ensureLocalStream = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      return stream;
    } catch (e: any) {
      const msg = String(e?.name || e?.message || 'unknown');
      if (/NotReadableError|NotAllowedError|OverconstrainedError|NotFoundError/i.test(msg)) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
          localStreamRef.current = stream;
          if (localVideoRef.current) localVideoRef.current.srcObject = stream;
          toast({ title: 'Joined with microphone only', status: 'info' });
          return stream;
        } catch {
          toast({ title: 'Joined without camera/mic', description: 'Device busy or permission denied.', status: 'warning' });
          return null;
        }
      }
      toast({ title: 'Camera/Mic error', description: e?.message, status: 'error' });
      return null;
    }
  }, [toast]);

  const getRtcConfig = useCallback((forceRelay?: boolean): RTCConfiguration => {
    const base: any = { ...(iceServers as any) };
    if (base.iceServers) base.iceServers = [...base.iceServers];
    if (forceRelay) base.iceTransportPolicy = 'relay';
    return base as RTCConfiguration;
  }, [iceServers]);

  const getOrCreatePC = useCallback(async (remoteId: string, forceRelay?: boolean) => {
    let pc = pcsRef.current.get(remoteId);
    if (pc) return pc;
    pc = new RTCPeerConnection(getRtcConfig(forceRelay));
    pcsRef.current.set(remoteId, pc);
    pc.onconnectionstatechange = () => {
      const anyConnected = Array.from(pcsRef.current.values()).some((p) => p.connectionState === 'connected');
      setConnected(anyConnected);
    };
    pc.onicecandidate = (ev) => { if (ev.candidate) postSignal('candidate', ev.candidate, remoteId); };
    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      const s = stream || new MediaStream([ev.track]);
      setRemoteStreams((prev) => ({ ...prev, [remoteId]: s }));
      const v = remoteVideoElsRef.current[remoteId];
      if (v) { v.srcObject = s; v.muted = remoteMuted; v.play().catch(() => {}); }
    };
    const local = await ensureLocalStream();
    try {
      if (local) local.getTracks().forEach((t) => { try { pc!.addTrack(t, local); } catch {} });
      if (!local?.getVideoTracks?.().length) { try { pc.addTransceiver('video', { direction: 'recvonly' }); } catch {} }
      if (!local?.getAudioTracks?.().length) { try { pc.addTransceiver('audio', { direction: 'recvonly' }); } catch {} }
    } catch {}
    return pc;
  }, [getRtcConfig, ensureLocalStream, postSignal, remoteMuted]);

  const sendOffer = useCallback(async (otherId: string, opts?: { iceRestart?: boolean }) => {
    const pc = await getOrCreatePC(otherId);
    if (!pc) return;
    const canInitiate = peerId < otherId;
    if (!canInitiate) return;
    try {
      const offer = await pc.createOffer(opts?.iceRestart ? ({ iceRestart: true } as any) : undefined);
      await pc.setLocalDescription(offer);
      await postSignal('offer', offer, otherId);
    } catch {}
  }, [getOrCreatePC, postSignal, peerId]);

  const connectToPeer = useCallback(async (otherId: string) => {
    await getOrCreatePC(otherId);
    await sendOffer(otherId);
  }, [getOrCreatePC, sendOffer]);

  // Join room once
  useEffect(() => {
    if (!roomId || !authToken) return;
    (async () => {
      try {
        await ensureLocalStream();
        const res = await fetch(`/api/rooms/${roomId}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}`, 'X-User-Email': authEmail || '' },
          body: JSON.stringify({ peerId }),
        });
        if (!res.ok) throw new Error('Failed to join room');
        setJoined(true);
      } catch (e: any) {
        toast({ title: 'Join failed', description: e?.message, status: 'error' });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, authToken]);

  // Handle incoming messages
  const handleSignal = useCallback(async (msg: any) => {
    const from = msg?.from;
    if (!from || from === peerId) return;
    const pc = await getOrCreatePC(from);
    if (!pc) return;
    if (msg.type === 'offer') {
      if (pc.signalingState === 'have-local-offer') {
        try { await pc.setLocalDescription({ type: 'rollback' } as any); } catch {}
      }
      await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
      const buf = pendingByPeerRef.current[from] || [];
      while (buf.length) { const c = buf.shift()!; try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {} }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await postSignal('answer', answer, from);
    } else if (msg.type === 'answer') {
      try {
        if (pc.signalingState !== 'have-local-offer' || pc.currentRemoteDescription) return;
        await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
        const buf = pendingByPeerRef.current[from] || [];
        while (buf.length) { const c = buf.shift()!; try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {} }
      } catch {}
    } else if (msg.type === 'candidate') {
      try {
        if (!pc.remoteDescription) {
          (pendingByPeerRef.current[from] || (pendingByPeerRef.current[from] = [])).push(msg.payload);
        } else {
          await pc.addIceCandidate(new RTCIceCandidate(msg.payload));
        }
      } catch {}
    } else if (msg.type === 'chat') {
      const p = msg.payload || {};
      setChat((prev) => prev.concat([{ id: msg.id, text: String(p.text || ''), senderName: p.senderName, senderEmail: p.senderEmail, peerId: from, ts: msg.ts, self: false }]));
    } else if (msg.type === 'bye') {
      try { const p = pcsRef.current.get(from); if (p) { try { p.close(); } catch {} } } catch {}
      pcsRef.current.delete(from);
      setRemoteStreams((prev) => { const n = { ...prev }; delete n[from]; return n; });
      delete pendingByPeerRef.current[from];
    }
  }, [getOrCreatePC, peerId, postSignal]);

  // Poll loop for signals
  useEffect(() => {
    if (!roomId || !joined || !authToken) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}/signal?since=${pollCursor}&excludeFrom=${peerId}&for=${peerId}`, {
          headers: { 'Authorization': `Bearer ${authToken}`, 'X-User-Email': authEmail || '' },
        });
        const data = await res.json();
        if (cancelled) return;
        setPollCursor(data.lastId || pollCursor);
        (data.messages || []).forEach((m: any) => handleSignal(m));
      } catch {}
    };
    const id = setInterval(tick, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [roomId, joined, pollCursor, peerId, handleSignal, authToken, authEmail]);

  // Participants heartbeat + auto-connect
  useEffect(() => {
    if (!roomId || !joined || !authToken) return;
    let cancelled = false;
    const seen = new Set<string>();
    const heartbeat = async () => {
      try {
        await fetch(`/api/rooms/${roomId}/participants`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}`, 'X-User-Email': authEmail || '' },
          body: JSON.stringify({ peerId }),
          keepalive: true as any,
        });
      } catch {}
    };
    const loop = async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}/participants`, { headers: { 'Authorization': `Bearer ${authToken}`, 'X-User-Email': authEmail || '' } });
        const data = await res.json();
        if (cancelled) return;
        const list: string[] = (data?.participants || []).filter((p: string) => p !== peerId);
        for (const id of list) {
          seen.add(id);
          if (!pcsRef.current.has(id)) {
            await getOrCreatePC(id);
            await connectToPeer(id);
          }
        }
        pcsRef.current.forEach((pc, id) => {
          if (!seen.has(id)) {
            try { pc.close(); } catch {}
            pcsRef.current.delete(id);
            setRemoteStreams((prev) => { const n = { ...prev }; delete n[id]; return n; });
            delete pendingByPeerRef.current[id];
          }
        });
        seen.clear();
      } catch {}
    };
    const timer = setInterval(() => { heartbeat(); loop(); }, 2000);
    heartbeat();
    loop();
    return () => { cancelled = true; clearInterval(timer); };
  }, [roomId, joined, authToken, authEmail, peerId, getOrCreatePC, connectToPeer]);

  const negotiate = useCallback(async () => {
    const entries = Array.from(pcsRef.current.keys());
    for (const rid of entries) { await sendOffer(rid); }
  }, [sendOffer]);

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    const tracks = stream?.getAudioTracks?.() || [];
    if (!tracks.length) { toast({ title: 'No microphone track', status: 'warning' }); return; }
    const newMuted = !isMicMuted;
    tracks.forEach((t) => (t.enabled = !newMuted));
    setIsMicMuted(newMuted);
  }, [isMicMuted, toast]);

  const toggleCam = useCallback(() => {
    const stream = localStreamRef.current;
    const tracks = stream?.getVideoTracks?.() || [];
    if (!tracks.length) { toast({ title: 'No camera track', status: 'warning' }); return; }
    const off = !isCamOff;
    tracks.forEach((t) => (t.enabled = !off));
    setIsCamOff(off);
  }, [isCamOff, toast]);

  const startScreenShare = useCallback(async () => {
    try {
      const display = await (navigator.mediaDevices as any).getDisplayMedia?.({ video: true, audio: false });
      if (!display) throw new Error('Screen share not supported');
      const track = display.getVideoTracks()[0];
      if (!track) throw new Error('No screen track');
      screenStreamRef.current = display;
      const pcs = Array.from(pcsRef.current.values());
      for (const pc of pcs) {
        let sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (!sender) { try { sender = pc.addTransceiver('video', { direction: 'sendonly' }).sender; } catch {} }
        if (sender) { await sender.replaceTrack(track); } else { pc.addTrack(track, display); }
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = display;
      setIsScreenSharing(true);
      track.onended = () => { stopScreenShare(); };
      await negotiate();
    } catch (e: any) {
      toast({ title: 'Failed to share screen', description: e?.message, status: 'error' });
    }
  }, [negotiate, toast]);

  const stopScreenShare = useCallback(async () => {
    try {
      const display = screenStreamRef.current;
      const cam = localStreamRef.current;
      const camTrack = cam?.getVideoTracks?.()[0];
      const pcs = Array.from(pcsRef.current.values());
      for (const pc of pcs) {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender && camTrack) { await sender.replaceTrack(camTrack); }
      }
      if (display) { try { display.getTracks().forEach((t) => t.stop()); } catch {} }
      if (localVideoRef.current && cam) localVideoRef.current.srcObject = cam;
      setIsScreenSharing(false);
      await negotiate();
    } catch {}
  }, [negotiate]);

  const endCall = useCallback(() => {
    try { postSignal('bye', {}); } catch {}
    try { stopAnalysis(); } catch {}
    try { screenStreamRef.current?.getTracks().forEach(t => { try { t.stop(); } catch {} }); } catch {}
    screenStreamRef.current = null;
    setIsScreenSharing(false);
    try {
      pcsRef.current.forEach((pc) => { try { pc.getSenders().forEach(s => { try { s.track?.stop(); } catch {} }); pc.close(); } catch {} });
      pcsRef.current.clear();
    } catch {}
    localStreamRef.current?.getTracks().forEach(t => { try { t.stop(); } catch {} });
    localStreamRef.current = null;
    setRemoteStreams({});
    setConnected(false);
    try {
      if (roomId && authToken) {
        fetch(`/api/rooms/${roomId}/leave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}`, 'X-User-Email': authEmail || '' },
          body: JSON.stringify({ peerId }),
          keepalive: true as any,
        }).catch(() => {});
      }
    } catch {}
    toast({ title: 'Left the room', status: 'info' });
  }, [postSignal, toast, roomId, authToken, authEmail, peerId, stopAnalysis]);

  const sendChat = useCallback(async (text: string) => {
    const payload = { text, senderName: authedUser?.name, senderEmail: authedUser?.email };
    setChat((prev) => prev.concat([{ text, senderName: payload.senderName, senderEmail: payload.senderEmail, peerId, ts: Date.now(), self: true }]));
    try {
      await postSignal('chat', payload);
    } catch {}
  }, [postSignal, authedUser?.name, authedUser?.email, peerId]);

  // Leave on tab close
  useEffect(() => {
    const onUnload = () => {
      try {
        if (!roomId || !authToken) return;
        navigator.sendBeacon?.(`/api/rooms/${roomId}/leave`, new Blob([JSON.stringify({ peerId })], { type: 'application/json' }));
      } catch {}
    };
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('beforeunload', onUnload); };
  }, [roomId, authToken, peerId]);

  return (
    <Box bgGradient="linear(to-b, white, blue.50)" minH="100vh" py={6}>
    <Container maxW="6xl">
      <VStack align="stretch" spacing={4}>
        <HStack>
          <Heading size="md">Student Room</Heading>
          <Tag>{roomId}</Tag>
          <Spacer />
          <Tooltip label={hasCopied ? 'Copied!' : 'Copy room link'}>
            <IconButton aria-label="copy" icon={<CopyIcon />} onClick={onCopy} variant="outline" />
          </Tooltip>
        </HStack>

        <Flex wrap="wrap" gap={3}>
          <Box flex="1 1 320px" bg="black" borderRadius="md" overflow="hidden" position="relative" minH="260px">
            <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <Box position="absolute" bottom={2} left={2} color="white" fontSize="xs" bg="blackAlpha.600" px={2} py={1} borderRadius="sm">You</Box>
          </Box>
          {Object.entries(remoteStreams).length === 0 ? (
            <Box flex="1 1 320px" bg="black" borderRadius="md" overflow="hidden" position="relative" minH="260px">
              <Box position="absolute" inset={0} display="flex" alignItems="center" justifyContent="center">
                <Text color="whiteAlpha.700">Waiting for peers…</Text>
              </Box>
            </Box>
          ) : (
            Object.entries(remoteStreams).map(([rid, stream]) => (
              <Box key={rid} flex="1 1 320px" bg="black" borderRadius="md" overflow="hidden" position="relative" minH="260px">
                <video
                  ref={(el) => { if (el) { (remoteVideoElsRef.current[rid] = el); el.srcObject = stream; el.muted = remoteMuted; el.play().catch(() => {}); } }}
                  autoPlay playsInline muted={remoteMuted}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <Box position="absolute" bottom={2} left={2} color="white" fontSize="xs" bg="blackAlpha.600" px={2} py={1} borderRadius="sm">{rid}</Box>
              </Box>
            ))
          )}
        </Flex>

        <HStack>
          {connected ? (
            <Button leftIcon={<CloseIcon />} colorScheme={'red'} onClick={endCall}>Leave</Button>
          ) : (
            <Button leftIcon={<PhoneIcon />} isDisabled variant="outline">Connecting…</Button>
          )}
          <Button leftIcon={<RepeatIcon />} onClick={() => window.location.reload()} variant="outline">Restart</Button>
          <Button onClick={toggleMic} variant="outline">{isMicMuted ? 'Unmute Mic' : 'Mute Mic'}</Button>
          <Button onClick={toggleCam} variant="outline">{isCamOff ? 'Turn Camera On' : 'Turn Camera Off'}</Button>
          <Button onClick={() => { isScreenSharing ? stopScreenShare() : startScreenShare(); }} variant="outline">
            {isScreenSharing ? 'Stop Share' : 'Share Screen'}
          </Button>
          <Button onClick={() => setRemoteMuted((m) => !m)} variant="outline">{remoteMuted ? 'Unmute Peers' : 'Mute Peers'}</Button>
          <Button onClick={() => { if (analysisEnabled) { stopAnalysis(); setAnalysisEnabled(false); } else { startAnalysis().catch(() => toast({ title: 'Start camera first', status: 'warning' })); setAnalysisEnabled(true); } }}>
            {analysisEnabled ? (isAnalyzing ? 'Stop Analysis' : 'Start Analysis') : 'Start Analysis'}
          </Button>
        </HStack>

        <SimpleGrid columns={[1, 2]} spacing={6} alignItems="start">
          <Box borderWidth="1px" borderRadius="lg" p={4} bg="white" boxShadow="sm">
            <EmotionDonut data={{ attentive: emotions?.attentive || 0, confused: emotions?.confused || 0, distracted: emotions?.distracted || 0 }} title="Your Engagement" />
          </Box>
          <Box borderWidth="1px" borderRadius="lg" p={4} bg="white" boxShadow="sm">
            <ChatPanel messages={chat} onSend={sendChat} />
          </Box>
        </SimpleGrid>

        <Box fontSize="sm" color="gray.500">Tip: share the room link with your teacher and classmates.</Box>
      </VStack>
    </Container>
    </Box>
  );
}

export default dynamic(() => Promise.resolve(StudentRoomPage), { ssr: false });
