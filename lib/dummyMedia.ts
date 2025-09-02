export type DummyHandle = {
  stream: MediaStream;
  stop: () => void;
};

export function createBlackVideoTrack(width = 640, height = 360, fps = 5) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  let raf: any;
  let timer: any;
  const draw = () => {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, height);
  };
  draw();
  const stream = (canvas as any).captureStream?.(fps) as MediaStream | undefined;
  const track = stream && stream.getVideoTracks()[0];
  // Keep drawing occasionally to keep frame pipeline active in some browsers
  timer = setInterval(draw, Math.max(200, 1000 / fps));
  if (track) {
    const origStop = track.stop.bind(track);
    track.stop = () => { try { clearInterval(timer); } catch {} try { cancelAnimationFrame(raf); } catch {}; origStop(); };
  }
  return track || null;
}

export function createSilentAudioTrack() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const dest = ctx.createMediaStreamDestination();
    // Create a constant source at near‑zero gain to avoid autoplay issues but keep a live track
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.00001;
    oscillator.connect(gain).connect(dest);
    try { oscillator.start(); } catch {}
    // do not call ctx.resume() to avoid gesture requirements; even suspended, track exists
    const track = dest.stream.getAudioTracks()[0] || null;
    const origStop = track && track.stop.bind(track);
    if (track) {
      track.stop = () => { try { oscillator.stop(); } catch {}; origStop!(); };
    }
    return track;
  } catch {
    return null;
  }
}

export function createDummyStream(): DummyHandle {
  const tracks: MediaStreamTrack[] = [];
  const v = createBlackVideoTrack();
  if (v) tracks.push(v);
  const a = createSilentAudioTrack();
  if (a) tracks.push(a);
  const stream = new MediaStream(tracks);
  return {
    stream,
    stop: () => {
      try { tracks.forEach((t) => { try { t.stop(); } catch {} }); } catch {}
    },
  };
}

