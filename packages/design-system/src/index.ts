export const colors = {
  chalk: '#F3F0E8',
  coal: '#1E2321',
  pine: '#245248',
  seaGlass: '#B7D3C8',
  clay: '#B95E45',
  mustard: '#C49A3A',
  emergency: '#A62E2E',
  white: '#FFFEFA',
} as const;

export const interaction = {
  minimumTargetPx: 48,
  motionMs: { fast: 150, default: 180, deliberate: 220 },
  reducedMotionMedia: '(prefers-reduced-motion: reduce)',
} as const;

export const typography = {
  family: 'Atkinson Hyperlegible Next Variable',
  fallback: 'ui-sans-serif, system-ui, sans-serif',
} as const;
