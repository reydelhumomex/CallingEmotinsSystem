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
import useEmotionAnalysis from '../../hooks/useEmotionAnalysis';
import { loadUser } from '../../lib/authClient';
import { Progress } from '@chakra-ui/react';

type SignalType = 'offer' | 'answer' | 'candidate' | 'bye';

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
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const pendingCandidatesRef = useRef<any[]>([]);

  const pageUrl = typeof window !== 'undefined' ? window.location.href : '';
  const { onCopy, hasCopied } = useClipboard(pageUrl);

  const iceServers = useMemo(() => {
    const servers: RTCIceServer[] = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ];
    const turnUrls = (process.env.NEXT_PUBLIC_TURN_URL || '').trim();
    const turnUser = (process.env.NEXT_PUBLIC_TURN_USERNAME || '').trim();
    const turnCred = (process.env.NEXT_PUBLIC_TURN_CREDENTIAL || '').trim();
    if (turnUrls) {
      const urls = turnUrls.split(',').map((u) => u.trim()).filter(Boolean);
      servers.push({ urls, username: turnUser || undefined, credential: turnCred || undefined });
    }
    return { iceServers: servers } as RTCConfiguration;
  }, []);

  const postSignal = useCallback(async (type: SignalType, payload: any) => {
    const u = loadUser();
    await fetch(`/api/rooms/${roomId}/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(u ? { 'Authorization': `Bearer ${u.token}`, 'X-User-Email': u.email } : {}) },
      body: JSON.stringify({ from: peerId, type, payload }),
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

  // Join room and auto-start connection based on role
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

        // Heuristic: if there is already an offer in the room from others, be the callee.
        let initiator = others.length === 0;
        try {
          const sigRes = await fetch(`/api/rooms/${roomId}/signal?since=0&excludeFrom=${peerId}`, {
            headers: { 'Authorization': `Bearer ${authToken}`, 'X-User-Email': authEmail || '' },
          });
          const sig = await sigRes.json();
          const hasRemoteOffer = Array.isArray(sig?.messages) && sig.messages.some((m: any) => m?.type === 'offer' && m?.from !== peerId);
          if (hasRemoteOffer) initiator = false;
        } catch {}

        setIsInitiator(initiator);
        setJoined(true);
        // Auto-connect: initiator starts call; callee prepares to answer
        setTimeout(() => {
          if (initiator) startCall(); else prepareAnswer();
        }, 0);
      } catch (e: any) {
        toast({ title: 'Failed to join room', description: e?.message, status: 'error' });
      }
    })();
  }, [peerId, roomId, toast, authToken, authEmail]);

  const setupPeerConnection = useCallback(async () => {
    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection(iceServers);
    } catch (e: any) {
      toast({ title: 'Failed to create RTCPeerConnection', description: e?.message, status: 'error' });
      throw e;
    }
    pcRef.current = pc;

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      setConnected(st === 'connected');
    };

    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      if (st === 'failed') {
        toast({ title: 'ICE connection failed', description: 'Try enabling TURN or check network.', status: 'error' });
      } else if (st === 'disconnected') {
        toast({ title: 'Peer disconnected', status: 'warning' });
      }
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) postSignal('candidate', ev.candidate);
    };

    pc.ontrack = (ev) => {
      if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream();
      const [stream] = ev.streams;
      if (stream) {
        remoteStreamRef.current = stream;
      } else {
        remoteStreamRef.current.addTrack(ev.track);
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
        // Attempt autoplay; some browsers (iOS Safari) require user gesture
        remoteVideoRef.current.play().catch(() => {
          toast({ title: 'Tap to start remote video', status: 'info' });
        });
      }
    };

    // get local media (with graceful fallback for incognito or busy devices)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    } catch (e: any) {
      // Fallbacks: try audio only, then recvonly
      const msg = String(e?.name || e?.message || 'unknown');
      if (/NotReadableError|NotAllowedError|OverconstrainedError|NotFoundError/i.test(msg)) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
          localStreamRef.current = stream;
          if (localVideoRef.current) localVideoRef.current.srcObject = stream;
          stream.getTracks().forEach((t) => pc.addTrack(t, stream));
          toast({ title: 'Joined with microphone only', status: 'info' });
        } catch {
          // As last resort, receive-only so student can still watch the teacher
          try {
            pc.addTransceiver('video', { direction: 'recvonly' });
            pc.addTransceiver('audio', { direction: 'recvonly' });
            toast({ title: 'Joined without camera/mic', description: 'Device busy or permission denied. You can still watch/listen.', status: 'warning' });
          } catch {}
        }
      } else {
        toast({
          title: 'Camera/Mic permission denied or unavailable',
          description: e?.message || 'Check browser permissions and that you are on HTTPS or localhost.',
          status: 'error',
        });
        throw e;
      }
    }

    return pc;
  }, [iceServers, postSignal]);

  // Start as initiator: createOffer and post
  const startCall = useCallback(async () => {
    if (pcRef.current) return;
    const pc = await setupPeerConnection();
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    await postSignal('offer', offer);
    toast({ title: 'Offer sent. Waiting for answer…', status: 'info' });
  }, [postSignal, setupPeerConnection, toast]);

  const prepareAnswer = useCallback(async () => {
    if (pcRef.current) return;
    try {
      await setupPeerConnection();
      toast({ title: 'Ready to answer when offer arrives', status: 'info' });
    } catch (e) {
      // error already surfaced by setupPeerConnection
    }
  }, [setupPeerConnection, toast]);

  // Handle incoming messages
  const handleSignal = useCallback(async (msg: any) => {
    const pc = pcRef.current || (await setupPeerConnection());
    pcRef.current = pc;
    if (msg.type === 'offer') {
      // Handle possible glare: if we already have a local offer, roll back and accept remote offer
      if (pc.signalingState === 'have-local-offer') {
        try { await pc.setLocalDescription({ type: 'rollback' } as any); } catch {}
      }
      await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
      // Flush any buffered ICE candidates now that remote description is set
      if (pendingCandidatesRef.current.length) {
        for (const c of pendingCandidatesRef.current.splice(0)) {
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
        }
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await postSignal('answer', answer);
    } else if (msg.type === 'answer') {
      // Only the offerer should set the remote answer
      if (pc.signalingState === 'have-local-offer' && !pc.currentRemoteDescription) {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
        // Flush any buffered ICE candidates now that remote description is set
        if (pendingCandidatesRef.current.length) {
          for (const c of pendingCandidatesRef.current.splice(0)) {
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
          }
        }
      }
    } else if (msg.type === 'candidate') {
      try {
        if (!pc.remoteDescription) {
          // Buffer until remote description is applied
          pendingCandidatesRef.current.push(msg.payload);
        } else {
          await pc.addIceCandidate(new RTCIceCandidate(msg.payload));
        }
      } catch (e) {
        // ignore errors caused by race conditions
      }
    } else if (msg.type === 'bye') {
      endCall();
    }
  }, [setupPeerConnection, postSignal]);

  // Poll loop for signals
  useEffect(() => {
    if (!roomId || !joined || !authToken) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}/signal?since=${pollCursor}&excludeFrom=${peerId}`, {
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

  const endCall = useCallback(() => {
    try { postSignal('bye', {}); } catch {}
    try { stopAnalysis(); } catch {}
    if (pcRef.current) {
      pcRef.current.getSenders().forEach(s => { try { s.track?.stop(); } catch {} });
      pcRef.current.close();
      pcRef.current = null;
    }
    localStreamRef.current?.getTracks().forEach(t => { try { t.stop(); } catch {} });
    localStreamRef.current = null;
    setConnected(false);
    toast({ title: 'Call ended', status: 'info' });
  }, [postSignal, toast]);

  const restart = useCallback(() => {
    endCall();
    setPollCursor(0);
    setTimeout(() => { if (isInitiator) startCall(); }, 100);
  }, [endCall, startCall, isInitiator]);

  useEffect(() => {
    if (isInitiator === true) {
      // auto start for initiator (redundant safety)
      startCall();
    }
  }, [isInitiator, startCall]);

  // Auto-prepare callee in incognito flows to prompt for camera/mic
  useEffect(() => {
    if (isInitiator === false && !pcRef.current) {
      prepareAnswer();
    }
  }, [isInitiator, prepareAnswer]);

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
          <Box flex="1 1 320px" bg="black" borderRadius="md" overflow="hidden" position="relative" minH="260px">
            <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <Box position="absolute" bottom={2} left={2} color="white" fontSize="xs" bg="blackAlpha.600" px={2} py={1} borderRadius="sm">Peer</Box>
          </Box>
        </Flex>

        <HStack>
          {connected ? (
            <Button leftIcon={<CloseIcon />} colorScheme={'red'} onClick={endCall}>Hang up</Button>
          ) : (
            <Button leftIcon={<PhoneIcon />} isDisabled variant="outline">Connecting…</Button>
          )}
          <Button leftIcon={<RepeatIcon />} onClick={restart} variant="outline">Restart</Button>
          <Button onClick={() => { if (analysisEnabled) { stopAnalysis(); setAnalysisEnabled(false); } else { startAnalysis().catch(() => toast({ title: 'Start camera first', status: 'warning' })); setAnalysisEnabled(true); } }}>
            {analysisEnabled ? (isAnalyzing ? 'Stop Analysis' : 'Start Analysis') : 'Start Analysis'}
          </Button>
        </HStack>

        <Box fontSize="sm" color="gray.500">
          Tip: open this URL in another tab or device and grant camera/mic. This demo uses REST polling for signaling only; media flows peer-to-peer.
        </Box>

        {/* Self HUD */}
        {emotions && (
          <Box borderWidth="1px" borderRadius="md" p={4}>
            <Heading size="sm" mb={2}>Your Emotions</Heading>
            <Text fontSize="sm">Attentive: {(emotions.attentive * 100).toFixed(0)}%</Text>
            <Progress value={emotions.attentive * 100} size="sm" colorScheme="green" mb={2} />
            <Text fontSize="sm">Confused: {(emotions.confused * 100).toFixed(0)}%</Text>
            <Progress value={emotions.confused * 100} size="sm" colorScheme="yellow" mb={2} />
            <Text fontSize="sm">Distracted: {(emotions.distracted * 100).toFixed(0)}%</Text>
            <Progress value={emotions.distracted * 100} size="sm" colorScheme="red" />
          </Box>
        )}

        {/* Teacher View */}
        {roleIsTeacher && (
          <Box borderWidth="1px" borderRadius="md" p={4}>
            <Heading size="sm" mb={2}>Teacher View (aggregated)</Heading>
            {agg.students.length === 0 ? (
              <Text color="gray.500">Awaiting students...</Text>
            ) : (
              <VStack align="stretch" spacing={3}>
                {agg.students.map((s) => (
                  <Box key={s.peerId}>
                    <Text fontSize="sm" fontWeight="semibold">{s.name || s.peerId}</Text>
                    <Text fontSize="xs" color="gray.500">updated {new Date(s.updatedAt).toLocaleTimeString()}</Text>
                    <Text fontSize="sm">Attentive: {(s.emotions.attentive * 100).toFixed(0)}%</Text>
                    <Progress value={s.emotions.attentive * 100} size="xs" colorScheme="green" mb={1} />
                    <Text fontSize="sm">Confused: {(s.emotions.confused * 100).toFixed(0)}%</Text>
                    <Progress value={s.emotions.confused * 100} size="xs" colorScheme="yellow" mb={1} />
                    <Text fontSize="sm">Distracted: {(s.emotions.distracted * 100).toFixed(0)}%</Text>
                    <Progress value={s.emotions.distracted * 100} size="xs" colorScheme="red" />
                  </Box>
                ))}
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
      </VStack>
    </Container>
  );
}

export default dynamic(() => Promise.resolve(CallPage), { ssr: false });
