import { Box, HStack, Text, Tooltip, useColorModeValue, VStack } from '@chakra-ui/react';
import { motion } from 'framer-motion';

export type EmotionData = { attentive: number; confused: number; distracted: number };

interface EmotionDonutProps {
  data: EmotionData;
  size?: number; // px
  thickness?: number; // px
  showLegend?: boolean;
  title?: string;
}

const MotionCircle = motion.circle;

function toSegments(d: EmotionData) {
  const safe = {
    attentive: Math.max(0, d.attentive || 0),
    confused: Math.max(0, d.confused || 0),
    distracted: Math.max(0, d.distracted || 0),
  };
  const sum = safe.attentive + safe.confused + safe.distracted || 1;
  const a = safe.attentive / sum;
  const c = safe.confused / sum;
  const d2 = safe.distracted / sum;
  return [
    { key: 'attentive', value: a, color: 'var(--donut-attentive)' },
    { key: 'confused', value: c, color: 'var(--donut-confused)' },
    { key: 'distracted', value: d2, color: 'var(--donut-distracted)' },
  ];
}

export default function EmotionDonut({ data, size = 160, thickness = 14, showLegend = true, title }: EmotionDonutProps) {
  const trackColor = useColorModeValue('#EDF2F7', 'rgba(255,255,255,0.12)');
  const segs = toSegments(data);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0; // start at 12 o'clock with a transform

  // CSS custom colors (fallback if no theme vars)
  const rootStyles = {
    ['--donut-attentive' as any]: useColorModeValue('#22c55e', '#4ade80'),
    ['--donut-confused' as any]: useColorModeValue('#f59e0b', '#fbbf24'),
    ['--donut-distracted' as any]: useColorModeValue('#ef4444', '#f87171'),
  } as React.CSSProperties;

  const center = size / 2;
  const percentage = Math.round(segs[0].value * 100);

  return (
    <VStack spacing={3} align="stretch" style={rootStyles}>
      {title && <Text fontWeight="semibold">{title}</Text>}
      <Box position="relative" width={`${size}px`} height={`${size}px`}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Track */}
          <circle cx={center} cy={center} r={radius} fill="none" stroke={trackColor} strokeWidth={thickness} />
          <g transform={`rotate(-90 ${center} ${center})`}>
            {segs.map((s, idx) => {
              const segLen = circumference * s.value;
              const dashArray = `${segLen} ${circumference - segLen}`;
              const dashOffset = circumference - offset;
              offset += segLen;
              return (
                <Tooltip key={s.key} label={`${s.key}: ${(s.value * 100).toFixed(0)}%`}>
                  <MotionCircle
                    cx={center}
                    cy={center}
                    r={radius}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={thickness}
                    strokeLinecap="round"
                    initial={{ strokeDasharray: `0 ${circumference}` }}
                    animate={{ strokeDasharray: dashArray, strokeDashoffset: dashOffset }}
                    transition={{ duration: 0.8, ease: 'easeInOut' }}
                  />
                </Tooltip>
              );
            })}
          </g>
        </svg>
        <Box position="absolute" top="50%" left="50%" transform="translate(-50%, -50%)" textAlign="center">
          <Text fontSize="xs" color="gray.500">Attentive</Text>
          <Text fontSize="2xl" fontWeight="bold">{percentage}%</Text>
        </Box>
      </Box>
      {showLegend && (
        <HStack spacing={4} justify="center">
          {[
            { k: 'Attentive', c: 'var(--donut-attentive)' },
            { k: 'Confused', c: 'var(--donut-confused)' },
            { k: 'Distracted', c: 'var(--donut-distracted)' },
          ].map((it) => (
            <HStack key={it.k} spacing={2}>
              <Box w="10px" h="10px" borderRadius="full" bg={it.c} />
              <Text fontSize="xs" color="gray.500">{it.k}</Text>
            </HStack>
          ))}
        </HStack>
      )}
    </VStack>
  );
}

