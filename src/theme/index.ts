import type { TextStyle } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';

export type AppThemeMode = 'light' | 'dark';

export type AppThemeColors = Readonly<{
  background: string;
  surface: string;
  surfaceMuted: string;
  surfaceElevated: string;
  surfacePressed: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  primary: string;
  onPrimary: string;
  primaryMuted: string;
  onPrimaryMuted: string;
  border: string;
  borderStrong: string;
  divider: string;
  track: string;
  success: string;
  successMuted: string;
  warning: string;
  warningMuted: string;
  danger: string;
  dangerMuted: string;
  onDanger: string;
  focus: string;
  shadow: string;
  overlay: string;
}>;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 48,
  giant: 64,
} as const;

export const radii = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 30,
  pill: 999,
} as const;

export const typography = {
  display: {
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  heading: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  subheading: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
  },
  bodyMedium: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
  },
  label: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  metric: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
} as const satisfies Record<string, TextStyle>;

export const layout = {
  maxContentWidth: 1180,
  minTouchTarget: 48,
  phoneBreakpoint: 600,
  tabletBreakpoint: 900,
  phoneGutter: 20,
  tabletGutter: 28,
  desktopGutter: 40,
} as const;

export type AppTheme = Readonly<{
  mode: AppThemeMode;
  isDark: boolean;
  colors: AppThemeColors;
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
  layout: typeof layout;
}>;

const lightColors: AppThemeColors = {
  background: '#F4F7F3',
  surface: '#FFFFFF',
  surfaceMuted: '#EAF0EA',
  surfaceElevated: '#FFFFFF',
  surfacePressed: '#E2EBE3',
  text: '#173126',
  textMuted: '#5E7066',
  textSubtle: '#7D8B82',
  primary: '#286646',
  onPrimary: '#FFFFFF',
  primaryMuted: '#DCECDF',
  onPrimaryMuted: '#1E5138',
  border: '#DCE5DE',
  borderStrong: '#BACABD',
  divider: '#E5EBE6',
  track: '#DCE5DE',
  success: '#287349',
  successMuted: '#DCEFE2',
  warning: '#8B5A17',
  warningMuted: '#F7E9CE',
  danger: '#A63F42',
  dangerMuted: '#F7DEDE',
  onDanger: '#FFFFFF',
  focus: '#2D7550',
  shadow: 'rgba(23, 49, 38, 0.10)',
  overlay: 'rgba(11, 25, 17, 0.48)',
};

const darkColors: AppThemeColors = {
  background: '#0D1510',
  surface: '#151F18',
  surfaceMuted: '#1B2920',
  surfaceElevated: '#1B2720',
  surfacePressed: '#24352A',
  text: '#ECF5EE',
  textMuted: '#AAB9AF',
  textSubtle: '#7F9185',
  primary: '#77C799',
  onPrimary: '#0B2A19',
  primaryMuted: '#203C2B',
  onPrimaryMuted: '#B3E3C3',
  border: '#2A3A30',
  borderStrong: '#43574A',
  divider: '#223128',
  track: '#2A3A30',
  success: '#78CF9B',
  successMuted: '#1E3A29',
  warning: '#E4B862',
  warningMuted: '#3D301B',
  danger: '#F08C8E',
  dangerMuted: '#432426',
  onDanger: '#351012',
  focus: '#8ED7AA',
  shadow: 'rgba(0, 0, 0, 0.28)',
  overlay: 'rgba(0, 0, 0, 0.64)',
};

export const lightTheme: AppTheme = {
  mode: 'light',
  isDark: false,
  colors: lightColors,
  spacing,
  radii,
  typography,
  layout,
};

export const darkTheme: AppTheme = {
  mode: 'dark',
  isDark: true,
  colors: darkColors,
  spacing,
  radii,
  typography,
  layout,
};

export const themes: Readonly<Record<AppThemeMode, AppTheme>> = {
  light: lightTheme,
  dark: darkTheme,
};

export function getAppTheme(mode: AppThemeMode): AppTheme {
  return themes[mode];
}

export function useAppTheme(): AppTheme {
  const colorScheme = useColorScheme();
  return colorScheme === 'dark' ? darkTheme : lightTheme;
}
