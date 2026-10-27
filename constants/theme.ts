// SWISH Design System — Canonical Tokens
// DO NOT use hardcoded values in components; reference these tokens only.

export const Colors = {
  // Core backgrounds
  background: '#09090E',
  surface: '#111218',
  surfaceElevated: '#18191F',
  surfaceBorder: '#1E2028',
  surfaceHighlight: '#22242C',

  // Brand
  primary: '#FFE600',
  primaryDim: '#302B00',
  primaryText: '#FFFFFF',

  // Accent
  accent: '#FFE600',
  accentDim: '#302B00',

  // Semantic
  success: '#22C55E',
  successDim: '#0D2B1A',
  warning: '#F59E0B',
  warningDim: '#2E200A',
  danger: '#EF4444',
  dangerDim: '#2A0F0F',
  info: '#06B6D4',
  infoDim: '#071E24',

  // Gold — premium / high-value
  gold: '#F5C842',
  goldDim: '#2A2000',

  // Text hierarchy
  textPrimary: '#F1F2F4',
  textSecondary: '#8B8FA8',
  textTertiary: '#50535E',
  textDisabled: '#33353D',
  textInverse: '#09090E',

  // Confidence levels
  confidenceHigh: '#22C55E',
  confidenceMedium: '#F59E0B',
  confidenceLow: '#EF4444',
  confidenceUnknown: '#50535E',

  // Status
  statusActive: '#22C55E',
  statusPending: '#F59E0B',
  statusFailed: '#EF4444',
  statusDemo: '#7C5CFC',
  statusSimulation: '#4F8EF7',
  statusConfirmed: '#22C55E',
  statusVerified: '#7C5CFC',

  // Transparent overlays
  overlay20: 'rgba(9,9,14,0.2)',
  overlay50: 'rgba(9,9,14,0.5)',
  overlay80: 'rgba(9,9,14,0.8)',
  overlayBlur: 'rgba(17,18,24,0.85)',
};

export const Typography = {
  // Scale (1.25 — Major Third)
  size: {
    xs: 11,
    sm: 13,
    base: 16,
    md: 18,
    lg: 20,
    xl: 24,
    xxl: 30,
    xxxl: 36,
    hero: 44,
  },
  weight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    extrabold: '800' as const,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.4,
    relaxed: 1.6,
    loose: 1.8,
  },
};

export const Spacing = {
  // 8pt grid
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  section: 48,
  hero: 64,
};

export const Radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  pill: 100,
  circle: 9999,
};

export const Shadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
  glow: {
    shadowColor: '#FFE600',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  glowGold: {
    shadowColor: '#F5C842',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
};

export const Animation = {
  fast: 150,
  normal: 250,
  slow: 350,
  spring: { damping: 15, stiffness: 200 },
};

export default {
  Colors,
  Typography,
  Spacing,
  Radius,
  Shadow,
  Animation,
};
