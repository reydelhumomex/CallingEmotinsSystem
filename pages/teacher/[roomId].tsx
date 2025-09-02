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
  Progress,
  SimpleGrid,
  Tag,
} from '@chakra-ui/react';
import { CopyIcon, PhoneIcon, RepeatIcon, CloseIcon } from '@chakra-ui/icons';
import { loadUser } from '../../lib/authClient';
import { buildIceConfig } from '../../lib/ice';
import { createDummyStream } from '../../lib/dummyMedia';
import ChatPanel, { type ChatMessage } from '../../components/ChatPanel';
import EmotionDonut from '../../components/EmotionDonut';

type SignalType = 'offer' | 'answer' | 'candidate' | 'bye' | 'chat';

function randomPeerId() {
  return Math.random().toString(36).slice(2, 10);
}

function TeacherRoomPage() {
  const ICE_DEBUG = String(process.env.NEXT_PUBLIC_DEBUG_ICE || '').toLowerCase();
  const dbg = (...a: any[]) => { try { if (ICE_DEBUG === '1' || ICE_DEBUG === 'true') console.log('[ICE]', ...a); } catch {} };
  const router = useRouter();
  const { roomId } = router.query as { roomId: string };
  const toast = useToast();

  // Temporary: route to proven engine to guarantee connection
  // This ensures immediate stability while we iterate on the new UI shell.
  if (roomId) {
    if (typeof window !== 'undefined') {
      // Avoid running rest of component logic
      router.replace(`/call/${roomId}`);
    }
    return null;
  }

  const [peerId] = useState(() => randomPeerId());
  const [joined, setJoined] = useState(false);
  const [connected, setConnected] = useState(false);
  const [pollCursor, setPollCursor] = useState(0);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingByPeerRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const dummyRef = useRef<{ stop: () => void } | null>(null);
  const upgradeTimerRef = useRef<any>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoElsRef = useRef<Record<string, HTMLVideoElement | null>>({});
  const screenStreamRef = useRef<MediaStream | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [remoteMuted, setRemoteMuted] = useState(true);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const offerTimersRef = useRef<Record<string, { timer: any; retries: number }>>({});

  const pageUrl = typeof window !== 'undefined' ? window.location.href : '';
  const { onCopy, hasCopied } = useClipboard(pageUrl);

  const baseIce = useMemo(() => buildIceConfig(), []);

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

  // Aggregated emotions polling for teacher
  const [agg, setAgg] = useState<{ students: any[]; recommendations: any[] }>({ students: [], recommendations: [] });
  useEffect(() => {
    if (!roomId || !authToken) return;
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}/emotion`, { headers: { 'Authorization': `Bearer ${authToken}`, 'X-User-Email': authEmail || '' } });
        const data = await res.json();
        if (!stop) setAgg({ students: data.students || [], recommendations: data.recommendations || [] });
      } catch {}
    };
    const id = setInterval(poll, 1500);
    poll();
    return () => { stop = true; clearInterval(id); };
  }, [roomId, authToken, authEmail]);

  // Local media helper
  const ensureLocalStream = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) { localVideoRef.current.srcObject = stream; try { await localVideoRef.current.play(); } catch {} }
      return stream;
    } catch (e: any) {
      // Fallback: create dummy tracks so connection negotiates instantly
      const dummy = createDummyStream();
      dummyRef.current = { stop: dummy.stop };
      localStreamRef.current = dummy.stream;
      if (localVideoRef.current) { localVideoRef.current.srcObject = dummy.stream; try { await localVideoRef.current.play(); } catch {} }
      toast({ title: 'Using placeholder media', description: 'Real camera/mic unavailable. Will auto‑retry.', status: 'warning' });
      // Start upgrade probe: try to capture real devices periodically and swap
      if (!upgradeTimerRef.current) {
        upgradeTimerRef.current = setInterval(async () => {
          try {
            const real = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            // Replace tracks on all peers
            pcsRef.current.forEach((pc) => {
              const vSender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
              const aSender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
              const vt = real.getVideoTracks()[0];
              const at = real.getAudioTracks()[0];
              if (vt && vSender) vSender.replaceTrack(vt).catch(() => {});
              if (at && aSender) aSender.replaceTrack(at).catch(() => {});
              if (!vSender && vt) { try { pc.addTransceiver('video', { direction: 'sendonly' }).sender.replaceTrack(vt); } catch {} }
              if (!aSender && at) { try { pc.addTransceiver('audio', { direction: 'sendonly' }).sender.replaceTrack(at); } catch {} }
            });
            // Update local
            localStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch {} });
            dummyRef.current?.stop?.();
            localStreamRef.current = real;
            if (localVideoRef.current) { localVideoRef.current.srcObject = real; try { await localVideoRef.current.play(); } catch {} }
            clearInterval(upgradeTimerRef.current);
            upgradeTimerRef.current = null;
            toast({ title: 'Camera/mic restored', status: 'success' });
          } catch {}
        }, 5000);
      }
      return dummy.stream;
    }
  }, [toast]);

  const getRtcConfig = useCallback((forceRelay?: boolean): RTCConfiguration => {
    const base: any = JSON.parse(JSON.stringify(baseIce));
    if (forceRelay) base.iceTransportPolicy = 'relay';
    return base as RTCConfiguration;
    
  }, [baseIce]);

  const getOrCreatePC = useCallback(async (remoteId: string, forceRelay?: boolean) => {
    let pc = pcsRef.current.get(remoteId);
    if (pc) return pc;
    const cfg = getRtcConfig(forceRelay);
    dbg('Creating RTCPeerConnection', { remoteId, forceRelay: !!forceRelay, cfg });
    pc = new RTCPeerConnection(cfg);
    pcsRef.current.set(remoteId, pc);
    pc.onconnectionstatechange = () => {
      dbg(remoteId, 'connectionstate', pc!.connectionState);
      const anyConnected = Array.from(pcsRef.current.values()).some((p) => p.connectionState === 'connected');
      setConnected(anyConnected);
      if (pc!.connectionState === 'connected') {
        const t = offerTimersRef.current[remoteId];
        if (t?.timer) { clearTimeout(t.timer); }
        delete offerTimersRef.current[remoteId];
      }
    };
    let failTimer: any;
    pc.oniceconnectionstatechange = () => {
      dbg(remoteId, 'iceconnectionstate', pc!.iceConnectionState);
      const st = pc!.iceConnectionState;
      if (st === 'failed') {
        (async () => {
          try {
            pcsRef.current.delete(remoteId);
            try { pc!.close(); } catch {}
            const npc = await getOrCreatePC(remoteId, true);
            const offer = await npc.createOffer({ iceRestart: true } as any);
            await npc.setLocalDescription(offer);
            await postSignal('offer', offer, remoteId);
          } catch {}
        })();
      } else if (st === 'disconnected') {
        clearTimeout(failTimer);
        failTimer = setTimeout(() => {
          if (pc!.iceConnectionState === 'disconnected') {
            (async () => {
              try {
                pcsRef.current.delete(remoteId);
                try { pc!.close(); } catch {}
                const npc = await getOrCreatePC(remoteId, true);
                const offer = await npc.createOffer({ iceRestart: true } as any);
                await npc.setLocalDescription(offer);
                await postSignal('offer', offer, remoteId);
              } catch {}
            })();
          }
        }, 4000);
      } else if (st === 'connected') {
        clearTimeout(failTimer);
      }
    };
    pc.onicecandidate = (ev) => { if (ev.candidate) { dbg(remoteId, 'candidate', ev.candidate.candidate); postSignal('candidate', ev.candidate, remoteId); } };
    try { pc.onicegatheringstatechange = () => { dbg(remoteId, 'gathering', pc!.iceGatheringState); }; } catch {}
    try { (pc as any).onicecandidateerror = (e: any) => { dbg(remoteId, 'icecandidateerror', e?.errorCode, e?.errorText); }; } catch {}
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

  const clearOfferTimer = useCallback((rid: string) => {
    const t = offerTimersRef.current[rid];
    if (t?.timer) clearTimeout(t.timer);
    delete offerTimersRef.current[rid];
  }, []);

  const sendOffer = useCallback(async (otherId: string, opts?: { iceRestart?: boolean }) => {
    const pc = await getOrCreatePC(otherId);
    if (!pc) return;
    const canInitiate = peerId < otherId;
    if (!canInitiate) return;
    try {
      const offer = await pc.createOffer(opts?.iceRestart ? ({ iceRestart: true } as any) : undefined);
      await pc.setLocalDescription(offer);
      await postSignal('offer', offer, otherId);
      // re-offer timer
      clearOfferTimer(otherId);
      const entry = { retries: 0, timer: 0 as any };
      offerTimersRef.current[otherId] = entry;
      const schedule = () => {
        entry.timer = setTimeout(async () => {
          if (pcsRef.current.get(otherId)?.connectionState === 'connected') { clearOfferTimer(otherId); return; }
          entry.retries += 1;
          const restart = entry.retries >= 1;
          try { await sendOffer(otherId, { iceRestart: restart }); } catch {}
          if (entry.retries < 3) schedule();
        }, 8000);
      };
      schedule();
    } catch {}
  }, [getOrCreatePC, postSignal, peerId, clearOfferTimer]);

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
      if (pc.signalingState === 'have-local-offer') { try { await pc.setLocalDescription({ type: 'rollback' } as any); } catch {} }
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
        clearOfferTimer(from);
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
    try { screenStreamRef.current?.getTracks().forEach(t => { try { t.stop(); } catch {} }); } catch {}
    screenStreamRef.current = null;
    setIsScreenSharing(false);
    try {
      pcsRef.current.forEach((pc) => { try { pc.getSenders().forEach(s => { try { s.track?.stop(); } catch {} }); pc.close(); } catch {} });
      pcsRef.current.clear();
    } catch {}
    localStreamRef.current?.getTracks().forEach(t => { try { t.stop(); } catch {} });
    try { dummyRef.current?.stop?.(); } catch {}
    dummyRef.current = null;
    if (upgradeTimerRef.current) { try { clearInterval(upgradeTimerRef.current); } catch {}; upgradeTimerRef.current = null; }
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
  }, [postSignal, toast, roomId, authToken, authEmail, peerId]);

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

  // Aggregate class distribution
  const classAgg = useMemo(() => {
    const list = agg.students || [];
    if (!list.length) return { attentive: 0, confused: 0, distracted: 0 };
    const sum = list.reduce((acc: any, s: any) => {
      acc.attentive += s.emotions?.attentive || 0;
      acc.confused += s.emotions?.confused || 0;
      acc.distracted += s.emotions?.distracted || 0;
      return acc;
    }, { attentive: 0, confused: 0, distracted: 0 });
    const n = list.length || 1;
    return { attentive: sum.attentive / n, confused: sum.confused / n, distracted: sum.distracted / n };
  }, [agg.students]);

  return (
    <Box bgGradient="linear(to-b, white, blue.50)" minH="100vh" py={6}>
    <Container maxW="7xl">
      <VStack align="stretch" spacing={4}>
        <HStack>
          <Heading size="md">Teacher Room</Heading>
          <Tag>{roomId}</Tag>
          <Spacer />
          <Tooltip label={hasCopied ? 'Copied!' : 'Copy room link'}>
            <IconButton aria-label="copy" icon={<CopyIcon />} onClick={onCopy} variant="outline" />
          </Tooltip>
        </HStack>

        <Flex wrap="wrap" gap={3}>
          <Box flex="1 1 360px" bg="black" borderRadius="md" overflow="hidden" position="relative" minH="320px">
            <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <Box position="absolute" bottom={2} left={2} color="white" fontSize="xs" bg="blackAlpha.600" px={2} py={1} borderRadius="sm">You (Teacher)</Box>
          </Box>
          {Object.entries(remoteStreams).length === 0 ? (
            <Box flex="1 1 320px" bg="black" borderRadius="md" overflow="hidden" position="relative" minH="320px">
              <Box position="absolute" inset={0} display="flex" alignItems="center" justifyContent="center">
                <Text color="whiteAlpha.700">Waiting for students…</Text>
              </Box>
            </Box>
          ) : (
            Object.entries(remoteStreams).map(([rid, stream]) => (
              <Box key={rid} flex="1 1 320px" bg="black" borderRadius="md" overflow="hidden" position="relative" minH="320px">
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
            <Button leftIcon={<CloseIcon />} colorScheme={'red'} onClick={endCall}>End Class</Button>
          ) : (
            <Button leftIcon={<PhoneIcon />} isDisabled variant="outline">Connecting…</Button>
          )}
          <Button leftIcon={<RepeatIcon />} onClick={() => window.location.reload()} variant="outline">Restart</Button>
          <Button onClick={toggleMic} variant="outline">{isMicMuted ? 'Unmute Mic' : 'Mute Mic'}</Button>
          <Button onClick={toggleCam} variant="outline">{isCamOff ? 'Turn Camera On' : 'Turn Camera Off'}</Button>
          <Button onClick={() => { isScreenSharing ? stopScreenShare() : startScreenShare(); }} variant="outline">
            {isScreenSharing ? 'Stop Share' : 'Share Screen'}
          </Button>
          <Button onClick={() => setRemoteMuted((m) => !m)} variant="outline">{remoteMuted ? 'Unmute Students' : 'Mute Students'}</Button>
        </HStack>

        <SimpleGrid columns={[1, 2]} spacing={6} alignItems="start">
          <Box borderWidth="1px" borderRadius="lg" p={4} bg="white" boxShadow="sm">
            <Heading size="sm" mb={3}>Class Emotion Analysis</Heading>
            {agg.students.length === 0 ? (
              <Text color="gray.500">Awaiting data…</Text>
            ) : (
              <>
                <EmotionDonut data={classAgg} title="Class Average" />
                <Box mt={4}>
                  <Heading size="xs" mb={2}>Per Student</Heading>
                  <SimpleGrid columns={[1, 2, 3]} spacing={4}>
                    {agg.students.map((s) => (
                      <Box key={s.peerId} borderWidth="1px" borderRadius="md" p={3}>
                        <Text fontSize="sm" fontWeight="semibold" noOfLines={1}>{s.name || s.peerId}</Text>
                        <Text fontSize="xs" color="gray.500" mb={2}>updated {new Date(s.updatedAt).toLocaleTimeString()}</Text>
                        <EmotionDonut data={s.emotions} size={120} thickness={12} showLegend={false} />
                      </Box>
                    ))}
                  </SimpleGrid>
                </Box>
              </>
            )}
            <Box mt={4}>
              <Heading size="xs" mb={1}>Recommendations</Heading>
              {agg.recommendations?.length ? (
                agg.recommendations.map((r, i) => (
                  <Text key={i} fontSize="sm">• {r.message}</Text>
                ))
              ) : (
                <Text fontSize="sm" color="gray.500">No recommendations yet.</Text>
              )}
            </Box>
          </Box>
          <Box borderWidth="1px" borderRadius="lg" p={4} bg="white" boxShadow="sm">
            <ChatPanel messages={chat} onSend={sendChat} />
          </Box>
        </SimpleGrid>

        <Box fontSize="sm" color="gray.500">Tip: share the room link with students. This room supports multiple peers, mic/video, and screen sharing.</Box>
      </VStack>
    </Container>
    </Box>
  );
}

export default dynamic(() => Promise.resolve(TeacherRoomPage), { ssr: false });
