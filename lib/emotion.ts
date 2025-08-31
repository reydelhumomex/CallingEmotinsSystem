export type EmotionDistribution = {
  attentive: number;
  confused: number;
  distracted: number;
};

export function clamp01(n: number) { return Math.max(0, Math.min(1, n)); }

export function normalizeDistribution(e: Partial<EmotionDistribution> = {}): EmotionDistribution {
  const keys: (keyof EmotionDistribution)[] = ['attentive', 'confused', 'distracted'];
  const arr = keys.map(k => Number(e[k] || 0));
  const sum = arr.reduce((a, b) => a + b, 0) || 1;
  const out: EmotionDistribution = {
    attentive: clamp01(arr[0] / sum),
    confused: clamp01(arr[1] / sum),
    distracted: clamp01(arr[2] / sum),
  };
  return out;
}

export function dominantLabel(e: EmotionDistribution) {
  const keys: (keyof EmotionDistribution)[] = ['attentive', 'confused', 'distracted'];
  const arr = keys.map(k => Number(e[k] || 0));
  const sum = arr.reduce((a, b) => a + b, 0) || 1;
  const idx = arr.indexOf(Math.max(...arr));
  const label = keys[idx];
  const score = arr[idx] / sum;
  return { label, score } as { label: keyof EmotionDistribution; score: number };
}

export function generateRecommendations(emotionData: { emotions: EmotionDistribution }[]) {
  if (!emotionData.length) return [] as { type: 'warning' | 'alert' | 'success'; message: string; priority: 'high' | 'medium' | 'low' }[];
  const recommendations: any[] = [];
  let attentiveCount = 0;
  let confusedCount = 0;
  let distractedCount = 0;

  emotionData.forEach(d => {
    if ((d.emotions.attentive || 0) > 0.6) attentiveCount++;
    if ((d.emotions.confused || 0) > 0.4) confusedCount++;
    if ((d.emotions.distracted || 0) > 0.5) distractedCount++;
  });

  const total = emotionData.length;
  if (total > 0) {
    if (confusedCount / total > 0.5) {
      recommendations.push({ type: 'warning', message: 'Many students appear confused. Consider slowing down or reviewing the material.', priority: 'high' });
    }
    if (distractedCount / total > 0.4) {
      recommendations.push({ type: 'alert', message: 'Students seem distracted. Try engaging them with interactive questions.', priority: 'medium' });
    }
    if (attentiveCount / total > 0.8) {
      recommendations.push({ type: 'success', message: 'Great! Students are highly engaged. Keep up the good work!', priority: 'low' });
    }
  }
  return recommendations;
}

