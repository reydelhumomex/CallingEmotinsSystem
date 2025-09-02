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
} from '@chakra-ui/react';
import { CopyIcon, PhoneIcon, RepeatIcon, CloseIcon } from '@chakra-ui/icons';
import ChatPanel, { type ChatMessage } from '../../components/ChatPanel';
import EmotionDonut from '../../components/EmotionDonut';
import { SimpleGrid } from '@chakra-ui/react';
import { buildIceConfig } from '../../lib/ice';
import useEmotionAnalysis from '../../hooks/useEmotionAnalysis';
import { loadUser } from '../../lib/authClient';
import { Progress } from '@chakra-ui/react';

type SignalType = 'offer' | 'answer' | 'candidate' | 'bye' | 'chat';

function randomPeerId() {
  return Math.random().toString(36).slice(2, 10);
}

function CallPage() {
  const router = useRouter();
  const { roomId } = router.query as { roomId: string };
  const toast = useToast();

  const [peerId] = useState(() => randomPeerId());
  const [joined, setJoined] = useState(false);
  const [isInitiator, setIsInitiator] = useState<boolean | null>(null);
  const [connected, setConnected] = useState(false);
  const [pollCursor, setPollCursor] = useState(0);
  // Multi‑peer state
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map()); // remoteId -> PC
  const pendingByPeerRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({}); // remoteId -> stream
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoElsRef = useRef<Record<string, HTMLVideoElement | null>>({});
  const pendingCandidatesRef = useRef<any[]>([]); // legacy (not used in multi)
  const screenStreamRef = useRef<MediaStream | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [remoteMuted, setRemoteMuted] = useState(true);
  // Note: modern browsers may block autoplay with audio; we default to muted
  const offerTimersRef = useRef<Record<string, { timer: any; retries: number }>>({});
  const [chat, setChat] = useState<ChatMessage[]>([]);

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
  const roleIsTeacher = authedUser?.role === 'teacher';
  const [analysisEnabled, setAnalysisEnabled] = useState(false);
  const { isAnalyzing, emotions, start: startAnalysis, stop: stopAnalysis } = useEmotionAnalysis(localVideoRef, {
    fps: 3,
    onUpdate: async (em) => {
      // push to API store for aggregation
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

  const [agg, setAgg] = useState<{ students: any[]; recommendations: any[] }>({ students: [], recommendations: [] });
  useEffect(() => {
    if (!roomId || !roleIsTeacher || !authToken) return;
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
  }, [roomId, roleIsTeacher, authToken, authEmail]);

  // Local media helper
  const ensureLocalStream = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    // get local media (with graceful fallback)
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
          toast({ title: 'Joined without camera/mic', description: 'Device busy or permission denied. You can still watch/listen.', status: 'warning' });
          return null;
        }
      }
      toast({ title: 'Camera/Mic error', description: e?.message, status: 'error' });
      return null;
    }
  }, [toast]);

  // Multi‑peer: create PC per remote
  const getRtcConfig = useCallback((forceRelay?: boolean): RTCConfiguration => {
    const base: any = JSON.parse(JSON.stringify(baseIce));
    if (forceRelay) base.iceTransportPolicy = 'relay';
    return base as RTCConfiguration;
  }, [baseIce]);

  const getOrCreatePC = useCallback(async (remoteId: string, forceRelay?: boolean) => {
    let pc = pcsRef.current.get(remoteId);
    if (pc && pc.signalingState === 'closed') {
      try { pc.close(); } catch {}
      pcsRef.current.delete(remoteId);
      pc = undefined as any;
    }
    if (pc) return pc;
    try {
      pc = new RTCPeerConnection(getRtcConfig(forceRelay));
    } catch (e: any) {
      toast({ title: 'Failed to create RTCPeerConnection', description: e?.message, status: 'error' });
      throw e;
    }
    pcsRef.current.set(remoteId, pc);

    pc.onconnectionstatechange = () => {
      const anyConnected = Array.from(pcsRef.current.values()).some((p) => p.connectionState === 'connected');
      setConnected(anyConnected);
      if (pc!.connectionState === 'connected') {
        const t = offerTimersRef.current[remoteId];
        if (t?.timer) { clearTimeout(t.timer); }
        delete offerTimersRef.current[remoteId];
      }
    };

    let failTimer: any;
    const tryIceRestart = async () => {
      try {
        if (pc?.signalingState === 'closed') return;
        // escalate via controlled offer sender
        await sendOffer(remoteId, { iceRestart: true });
      } catch {}
    };
    pc.oniceconnectionstatechange = () => {
      const st = pc!.iceConnectionState;
      if (st === 'failed') {
        // escalate to relay-only by rebuilding the PC
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

    pc.onicecandidate = (ev) => {
      if (ev.candidate) postSignal('candidate', ev.candidate, remoteId);
    };

    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      const s = stream || new MediaStream([ev.track]);
      setRemoteStreams((prev) => ({ ...prev, [remoteId]: s }));
      const v = remoteVideoElsRef.current[remoteId];
      if (v) {
        v.srcObject = s;
        v.muted = remoteMuted;
        v.play().catch(() => {});
      }
    };

    // Add local tracks (if any)
    const local = await ensureLocalStream();
    try {
      if (local) local.getTracks().forEach((t) => { try { pc!.addTrack(t, local); } catch {} });
      // Ensure we can still receive if no camera
      if (!local?.getVideoTracks?.().length) {
        try { pc.addTransceiver('video', { direction: 'recvonly' }); } catch {}
      }
      if (!local?.getAudioTracks?.().length) {
        try { pc.addTransceiver('audio', { direction: 'recvonly' }); } catch {}
      }
    } catch {}

    return pc;
  }, [getRtcConfig, ensureLocalStream, postSignal, remoteMuted, toast]);

  const clearOfferTimer = useCallback((rid: string) => {
    const t = offerTimersRef.current[rid];
    if (t?.timer) clearTimeout(t.timer);
    delete offerTimersRef.current[rid];
  }, []);

  const sendOffer = useCallback(async (otherId: string, opts?: { iceRestart?: boolean; forceInitiate?: boolean }) => {
    const pc = await getOrCreatePC(otherId);
    if (!pc) return;
    const canInitiate = opts?.forceInitiate ? true : (peerId < otherId);
    if (!canInitiate) return;
    try {
      const offer = await pc.createOffer(opts?.iceRestart ? ({ iceRestart: true } as any) : undefined);
      await pc.setLocalDescription(offer);
      await postSignal('offer', offer, otherId);
      // arm re-offer timer
      clearOfferTimer(otherId);
      const entry = { retries: 0, timer: 0 as any };
      offerTimersRef.current[otherId] = entry;
      const schedule = () => {
        entry.timer = setTimeout(async () => {
          if (pcsRef.current.get(otherId)?.connectionState === 'connected') { clearOfferTimer(otherId); return; }
          entry.retries += 1;
          const restart = entry.retries >= 1; // second try uses ICE restart
          try { await sendOffer(otherId, { iceRestart: restart, forceInitiate: true }); } catch {}
          if (entry.retries < 3) schedule();
        }, 8000);
      };
      schedule();
    } catch {}
  }, [getOrCreatePC, postSignal, clearOfferTimer, peerId]);

  // removed explicit shouldInitiate helper; inline comparison in sendOffer

  const connectToPeer = useCallback(async (otherId: string) => {
    await getOrCreatePC(otherId);
    await sendOffer(otherId, { forceInitiate: true });
  }, [getOrCreatePC, sendOffer]);

  // Join room and set up initial peers
  useEffect(() => {
    if (!roomId || !authToken) return;
    (async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}`, 'X-User-Email': authEmail || '' },
          body: JSON.stringify({ peerId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
        const participants: string[] = data.participants || [];
        const others = participants.filter((p) => p !== peerId);
        setIsInitiator(others.length === 0);
        setJoined(true);
        // Baseline signal cursor to ignore old history
        try {
          const sres = await fetch(`/api/rooms/${roomId}/signal?since=0&excludeFrom=${peerId}&for=${peerId}` , { headers: { 'Authorization': `Bearer ${authToken}`, 'X-User-Email': authEmail || '' } });
          const sdata = await sres.json();
          if (typeof sdata?.lastId === 'number') setPollCursor(sdata.lastId);
        } catch {}
        // Initial heartbeat
        try {
          await fetch(`/api/rooms/${roomId}/participants`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}`, 'X-User-Email': authEmail || '' },
            body: JSON.stringify({ peerId }),
          });
        } catch {}
        await ensureLocalStream();
        // Connect to existing peers (offer if lexicographically lower)
        for (const other of others) {
          await getOrCreatePC(other);
          await connectToPeer(other);
        }
      } catch (e: any) {
        toast({ title: 'Failed to join room', description: e?.message, status: 'error' });
      }
    })();
  }, [peerId, roomId, toast, authToken, authEmail, getOrCreatePC, connectToPeer, ensureLocalStream]);

  // remove single‑peer setupPeerConnection (replaced by multi‑peer getOrCreatePC)

  // No-op placeholders retained for minimal UI churn
  const startCall = useCallback(async () => {
    // Initial offers are created per-peer during join/participants polling
    return;
  }, []);

  const prepareAnswer = useCallback(async () => {
    await ensureLocalStream();
  }, [ensureLocalStream]);

  // Leave on tab close/navigation (best-effort)
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

  // Handle incoming messages
  const handleSignal = useCallback(async (msg: any) => {
    // Route by sender
    const from = msg?.from;
    if (!from || from === peerId) return;
    // Ensure we operate on a live PC (replace closed ones)
    let pc = pcsRef.current.get(from);
    if (!pc || pc.signalingState === 'closed') {
      if (pc) { try { pc.close(); } catch {}; pcsRef.current.delete(from); }
      pc = await getOrCreatePC(from);
      if (!pc) return;
    }
    if (msg.type === 'offer') {
      // If previous local offer exists, rollback
      if (pc.signalingState === 'have-local-offer') {
        try { await pc.setLocalDescription({ type: 'rollback' } as any); } catch {}
      }
      // Guard against closed between await points
      if (pc.signalingState === 'closed') {
        try { pcsRef.current.delete(from); } catch {}
        pc = await getOrCreatePC(from);
        if (!pc) return;
      }
      try { await pc.setRemoteDescription(new RTCSessionDescription(msg.payload)); } catch { return; }
      // apply buffered ICE
      const buf = pendingByPeerRef.current[from] || [];
      while (buf.length) {
        const c = buf.shift()!;
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
      }
      const answer = await pc.createAnswer();
      try { await pc.setLocalDescription(answer); } catch { return; }
      try { await postSignal('answer', answer, from); } catch {}
    } else if (msg.type === 'answer') {
      try {
        // Ignore stale/duplicate answers
        if (pc.signalingState === 'closed') return;
        if (pc.signalingState !== 'have-local-offer' || pc.currentRemoteDescription) return;
        try { await pc.setRemoteDescription(new RTCSessionDescription(msg.payload)); } catch { return; }
        const buf = pendingByPeerRef.current[from] || [];
        while (buf.length) {
          const c = buf.shift()!;
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
        }
        clearOfferTimer(from);
      } catch (e: any) {
        // Swallow race where state flips to stable between check and setRemoteDescription
        const msgTxt = String(e?.message || e);
        if (!/wrong state|InvalidStateError|stable/i.test(msgTxt)) {
          console.warn('Failed to apply remote answer', e);
        }
      }
    } else if (msg.type === 'candidate') {
      try {
        if (pc.signalingState === 'closed') return;
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
      // One peer hung up; close only their PC (do not stop shared tracks)
      try {
        const p = pcsRef.current.get(from);
        if (p) { try { p.close(); } catch {} }
      } catch {}
      pcsRef.current.delete(from);
      setRemoteStreams((prev) => { const n = { ...prev }; delete n[from]; return n; });
      delete pendingByPeerRef.current[from];
      clearOfferTimer(from);
    }
  }, [getOrCreatePC, peerId, postSignal, clearOfferTimer]);

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
      } catch (e) {
        // ignore
      }
    };
    const id = setInterval(tick, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [roomId, joined, pollCursor, peerId, handleSignal, authToken, authEmail]);

  // Poll participants to auto-connect to new peers
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
        // Clean up peers that left
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
    // Inform server we left (best-effort)
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
    toast({ title: 'Call ended', status: 'info' });
  }, [postSignal, toast, roomId, authToken, authEmail, peerId]);

  const restart = useCallback(async () => {
    endCall();
    setPollCursor(0);
    try {
      await ensureLocalStream();
      if (!roomId || !authToken) return;
      const res = await fetch(`/api/rooms/${roomId}/participants`, { headers: { 'Authorization': `Bearer ${authToken}`, 'X-User-Email': authEmail || '' } });
      const data = await res.json();
      const others: string[] = (data?.participants || []).filter((p: string) => p !== peerId);
      for (const id of others) {
        await getOrCreatePC(id);
        await connectToPeer(id);
      }
    } catch {}
  }, [endCall, ensureLocalStream, roomId, authToken, authEmail, peerId, getOrCreatePC, connectToPeer]);

  const sendChat = useCallback(async (text: string) => {
    const payload = { text, senderName: authedUser?.name, senderEmail: authedUser?.email };
    setChat((prev) => prev.concat([{ text, senderName: payload.senderName, senderEmail: payload.senderEmail, peerId, ts: Date.now(), self: true }]));
    try {
      await postSignal('chat', payload);
    } catch {}
  }, [postSignal, authedUser?.name, authedUser?.email, peerId]);

  // Apply mute to all remote video elements
  useEffect(() => {
    const els = Object.values(remoteVideoElsRef.current || {});
    els.forEach((v) => { if (v) v.muted = remoteMuted; });
  }, [remoteMuted]);

  useEffect(() => {
    if (isInitiator === true) {
      // auto start for initiator (redundant safety)
      startCall();
    }
  }, [isInitiator, startCall]);

  // Auto-prepare callee in incognito flows to prompt for camera/mic
  useEffect(() => {
    if (isInitiator === false && pcsRef.current.size === 0) {
      prepareAnswer();
    }
  }, [isInitiator, prepareAnswer]);

  // Helpers
  const negotiate = useCallback(async () => {
    const entries = Array.from(pcsRef.current.keys());
    for (const rid of entries) {
      await sendOffer(rid);
    }
  }, [sendOffer]);

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    const tracks = stream?.getAudioTracks?.() || [];
    if (!tracks.length) {
      toast({ title: 'No microphone track', status: 'warning' });
      return;
    }
    const newMuted = !isMicMuted;
    tracks.forEach((t) => (t.enabled = !newMuted));
    setIsMicMuted(newMuted);
  }, [isMicMuted, toast]);

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
        if (!sender) {
          try { sender = pc.addTransceiver('video', { direction: 'sendonly' }).sender; } catch { /* fallback */ }
        }
        if (sender) {
          await sender.replaceTrack(track);
        } else {
          pc.addTrack(track, display);
        }
      }
      // Local preview switches to screen
      if (localVideoRef.current) localVideoRef.current.srcObject = display;
      setIsScreenSharing(true);
      track.onended = () => { stopScreenShare(); };
      // Renegotiate for broad compatibility
      await negotiate();
    } catch (e: any) {
      toast({ title: 'Failed to share screen', description: e?.message, status: 'error' });
    }
  }, [negotiate, toast]);

  const stopScreenShare = useCallback(async () => {
    try {
      const screen = screenStreamRef.current;
      const cam = localStreamRef.current;
      screen?.getTracks().forEach((t) => { try { t.stop(); } catch {} });
      screenStreamRef.current = null;
      setIsScreenSharing(false);
      const camTrack = cam?.getVideoTracks?.()[0] || null;
      const pcs = Array.from(pcsRef.current.values());
      for (const pc of pcs) {
        const videoSender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(camTrack);
        }
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = cam || null;
      }
      await negotiate();
    } catch {}
  }, [negotiate]);

  if (!authedUser) {
    return (
      <Container maxW="lg" py={10}>
        <VStack spacing={4}>
          <Heading size="md">Login required</Heading>
          <Text>Please login on the home page before joining a call.</Text>
          <Button onClick={() => router.push('/')}>Go to Home</Button>
        </VStack>
      </Container>
    );
  }

  return (
    <Container maxW="6xl" py={6}>
      <HStack>
        <Heading size="md">Room {roomId}</Heading>
        <Spacer />
        <Tooltip label={hasCopied ? 'Copied!' : 'Copy link'}>
          <IconButton aria-label="copy" icon={<CopyIcon />} onClick={onCopy} />
        </Tooltip>
      </HStack>

      <VStack spacing={4} align="stretch" mt={4}>
        <Text color="gray.500">Your ID: {peerId} • Role: {isInitiator == null ? '…' : isInitiator ? 'Caller' : 'Callee'}</Text>
        <Flex gap={4} flexWrap="wrap">
          <Box flex="1 1 320px" bg="black" borderRadius="md" overflow="hidden" position="relative" minH="260px">
            <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
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
            <Button leftIcon={<CloseIcon />} colorScheme={'red'} onClick={endCall}>Hang up</Button>
          ) : (
            <Button leftIcon={<PhoneIcon />} isDisabled variant="outline">Connecting…</Button>
          )}
          <Button leftIcon={<RepeatIcon />} onClick={restart} variant="outline">Restart</Button>
          <Button onClick={toggleMic} variant="outline">{isMicMuted ? 'Unmute Mic' : 'Mute Mic'}</Button>
          <Button onClick={() => { isScreenSharing ? stopScreenShare() : startScreenShare(); }} variant="outline">
            {isScreenSharing ? 'Stop Share' : 'Share Screen'}
          </Button>
          <Button onClick={() => setRemoteMuted((m) => !m)} variant="outline">{remoteMuted ? 'Unmute Peer' : 'Mute Peer'}</Button>
          <Button onClick={() => { if (analysisEnabled) { stopAnalysis(); setAnalysisEnabled(false); } else { startAnalysis().catch(() => toast({ title: 'Start camera first', status: 'warning' })); setAnalysisEnabled(true); } }}>
            {analysisEnabled ? (isAnalyzing ? 'Stop Analysis' : 'Start Analysis') : 'Start Analysis'}
          </Button>
        </HStack>

        <Box fontSize="sm" color="gray.500">
          Tip: open this URL in another tab or device and grant camera/mic. This demo uses REST polling for signaling only; media flows peer-to-peer.
        </Box>

        <SimpleGrid columns={[1, roleIsTeacher ? 2 : 1]} spacing={6} alignItems="start">
          {emotions && (
            <Box borderWidth="1px" borderRadius="lg" p={4} bg="white" boxShadow="sm">
              <Heading size="sm" mb={2}>Your Engagement</Heading>
              <EmotionDonut data={{ attentive: emotions.attentive, confused: emotions.confused, distracted: emotions.distracted }} />
            </Box>
          )}

          <Box borderWidth="1px" borderRadius="lg" p={4} bg="white" boxShadow="sm">
            <ChatPanel messages={chat} onSend={sendChat} />
          </Box>

          {roleIsTeacher && (
            <Box borderWidth="1px" borderRadius="lg" p={4} bg="white" boxShadow="sm">
              <Heading size="sm" mb={2}>Class Emotion Analysis</Heading>
              {agg.students.length === 0 ? (
                <Text color="gray.500">Awaiting students...</Text>
              ) : (
                <VStack align="stretch" spacing={3}>
                  {/* Class average donut */}
                  {(() => {
                    const list = agg.students || [];
                    const sum = list.reduce((acc: any, s: any) => { acc.attentive += s.emotions.attentive; acc.confused += s.emotions.confused; acc.distracted += s.emotions.distracted; return acc; }, { attentive: 0, confused: 0, distracted: 0 });
                    const n = Math.max(1, list.length);
                    return <EmotionDonut data={{ attentive: sum.attentive / n, confused: sum.confused / n, distracted: sum.distracted / n }} title="Class Average" />;
                  })()}
                  <Heading size="xs">Per Student</Heading>
                  <SimpleGrid columns={[1, 2, 3]} spacing={4}>
                    {agg.students.map((s) => (
                      <Box key={s.peerId} borderWidth="1px" borderRadius="md" p={3}>
                        <Text fontSize="sm" fontWeight="semibold" noOfLines={1}>{s.name || s.peerId}</Text>
                        <Text fontSize="xs" color="gray.500" mb={2}>updated {new Date(s.updatedAt).toLocaleTimeString()}</Text>
                        <EmotionDonut data={s.emotions} size={120} thickness={12} showLegend={false} />
                      </Box>
                    ))}
                  </SimpleGrid>
                  <Box>
                    <Heading size="xs" mb={1}>Recommendations</Heading>
                    {agg.recommendations?.length ? (
                      agg.recommendations.map((r, i) => (
                        <Text key={i} fontSize="sm">• {r.message}</Text>
                      ))
                    ) : (
                      <Text fontSize="sm" color="gray.500">No recommendations yet.</Text>
                    )}
                  </Box>
                </VStack>
              )}
            </Box>
          )}
        </SimpleGrid>
      </VStack>
    </Container>
  );
}

export default dynamic(() => Promise.resolve(CallPage), { ssr: false });
