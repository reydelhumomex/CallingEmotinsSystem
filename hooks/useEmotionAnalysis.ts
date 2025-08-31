import { useCallback, useEffect, useRef, useState } from 'react';
import type { EmotionDistribution } from '../lib/emotion';

type UseEmotionOptions = {
  fps?: number; // analysis rate
  onUpdate?: (emotions: EmotionDistribution) => void; // callback per analysis
};

export default function useEmotionAnalysis(videoRef: React.RefObject<HTMLVideoElement>, opts: UseEmotionOptions = {}) {
  const { fps = 3, onUpdate } = opts;
  const [isAnalyzing, setAnalyzing] = useState(false);
  const [emotions, setEmotions] = useState<EmotionDistribution | null>(null);
  const holisticRef = useRef<any>(null);
  const timerRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const stop = useCallback(() => {
    setAnalyzing(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (holisticRef.current) {
      try { holisticRef.current.close?.(); } catch {}
      holisticRef.current = null;
    }
  }, []);

  useEffect(() => () => { stop(); }, [stop]);

  const analyzeResults = useCallback((results: any) => {
    const em: EmotionDistribution = analyzeWithHeuristics(results);
    setEmotions(em);
    onUpdate?.(em);
  }, [onUpdate]);

  const loadScript = (src: string) => new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script ${src}`));
    document.head.appendChild(s);
  });

  const loadHolisticCtor = async (): Promise<any> => {
    try {
      // Prefer ESM import if available
      const mod: any = await import('@mediapipe/holistic');
      if (mod?.Holistic) return mod.Holistic;
    } catch {}
    // Fallback to UMD from CDN to avoid bundler/runtime edge cases
    if (!(window as any).Holistic) {
      await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/holistic/holistic.js');
    }
    const ctor = (window as any)?.Holistic?.Holistic;
    if (!ctor) throw new Error('MediaPipe Holistic failed to load');
    return ctor;
  };

  const start = useCallback(async () => {
    if (!videoRef.current) throw new Error('Video ref is null');
    if (isAnalyzing) return;
    setAnalyzing(true);

    const HolisticCtor = await loadHolisticCtor();
    const holistic = new HolisticCtor({
      locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`,
    } as any);
    holistic.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      smoothSegmentation: true,
      refineFaceLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    holistic.onResults(analyzeResults);
    holisticRef.current = holistic;

    // prepare canvas
    const canvas = canvasRef.current || document.createElement('canvas');
    canvasRef.current = canvas;

    timerRef.current = setInterval(async () => {
      try {
        const v = videoRef.current!;
        if (!v || v.readyState < 2) return;
        const w = v.videoWidth || 640;
        const h = v.videoHeight || 480;
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(v, 0, 0, w, h);
        try {
          await holistic.send({ image: canvas });
        } catch {
          // ignore send failures (e.g., asset not yet ready)
        }
      } catch (e) {
        // ignore frame errors
      }
    }, Math.max(1000 / fps, 100));
  }, [videoRef, analyzeResults, fps, isAnalyzing]);

  return { isAnalyzing, emotions, start, stop };
}

// Heuristics ported from your Python example (indices from MediaPipe FaceMesh/Pose)
function analyzeWithHeuristics(results: any): EmotionDistribution {
  let emotions: EmotionDistribution = { attentive: 0.5, confused: 0.0, distracted: 0.0 };

  const face = results.faceLandmarks || results.faceLandmarks?.[0];
  const pose = results.poseLandmarks;

  if (face) {
    emotions = analyzeFacial(face, emotions);
  }
  if (pose) {
    emotions = avgDistributions(emotions, analyzePose(pose));
  }
  // normalize to sum=1
  const sum = emotions.attentive + emotions.confused + emotions.distracted || 1;
  return { attentive: emotions.attentive / sum, confused: emotions.confused / sum, distracted: emotions.distracted / sum };
}

function avgDistributions(a: EmotionDistribution, b: EmotionDistribution): EmotionDistribution {
  return {
    attentive: (a.attentive + b.attentive) / 2,
    confused: (a.confused + b.confused) / 2,
    distracted: (a.distracted + b.distracted) / 2,
  };
}

function analyzeFacial(landmarks: any[], base: EmotionDistribution): EmotionDistribution {
  const e: EmotionDistribution = { attentive: base.attentive, confused: base.confused, distracted: base.distracted };
  try {
    // Eye openness (145,159 left; 374,386 right)
    const leftEyeH = Math.abs(landmarks[145].y - landmarks[159].y);
    const rightEyeH = Math.abs(landmarks[374].y - landmarks[386].y);
    const avgEye = (leftEyeH + rightEyeH) / 2;
    if (avgEye > 0.015) {
      e.attentive = Math.max(e.attentive, 0.8);
    } else if (avgEye < 0.008) {
      e.distracted = Math.max(e.distracted, 0.7);
      e.attentive = Math.min(0.2, e.attentive);
    }

    // Eyebrow furrow: indices 70, 300 vs nose bridge 6
    const leftBrowY = landmarks[70].y;
    const rightBrowY = landmarks[300].y;
    const noseBridgeY = landmarks[6].y;
    const browFurrow = (noseBridgeY - leftBrowY) + (noseBridgeY - rightBrowY);
    if (browFurrow > 0.02) {
      e.confused = Math.max(e.confused, 0.6);
      e.attentive = Math.max(0.3, e.attentive - 0.2);
    }

    // Mouth openness: 13(top), 14(bottom), width: 61..291
    const mouthTop = landmarks[13];
    const mouthBottom = landmarks[14];
    const mouthHeight = Math.abs(mouthTop.y - mouthBottom.y);
    if (mouthHeight > 0.02) e.confused = Math.max(e.confused, 0.4);
  } catch {
    // ignore if some indices missing
  }
  return e;
}

function analyzePose(landmarks: any[]): EmotionDistribution {
  const e: EmotionDistribution = { attentive: 0.5, confused: 0.0, distracted: 0.0 };
  try {
    const nose = landmarks[0];
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const shoulderCenterX = (leftShoulder.x + rightShoulder.x) / 2;
    const headTilt = Math.abs(nose.x - shoulderCenterX);
    if (headTilt > 0.1) {
      e.confused = Math.max(e.confused, 0.4);
      e.attentive = Math.max(0.2, e.attentive - 0.3);
    }
    if (nose.x < shoulderCenterX - 0.15 || nose.x > shoulderCenterX + 0.15) {
      e.distracted = Math.max(e.distracted, 0.6);
      e.attentive = Math.min(0.3, e.attentive);
    }
  } catch {
    // ignore
  }
  return e;
}
