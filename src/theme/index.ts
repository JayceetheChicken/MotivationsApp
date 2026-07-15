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
  primaryPressed: string;
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
  dangerPressed: string;
  dangerMuted: string;
  onDanger: string;
  focus: string;
  focusBackground: string;
  focusText: string;
  focusTextMuted: string;
  focusSurface: string;
  focusSurfaceStrong: string;
  focusBorder: string;
  focusBorderStrong: string;
  focusShadow: string;
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
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 20,
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
  background: '#F5F6F8',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF0F4',
  surfaceElevated: '#FFFFFF',
  surfacePressed: '#E4E7EC',
  text: '#242424',
  textMuted: '#616161',
  textSubtle: '#8A8886',
  primary: '#4F6BED',
  primaryPressed: '#3D54C7',
  onPrimary: '#FFFFFF',
  primaryMuted: '#E8ECFF',
  onPrimaryMuted: '#3347A3',
  border: '#DADCE0',
  borderStrong: '#C4C7CC',
  divider: '#E7E9ED',
  track: '#E1E4E9',
  success: '#237B4B',
  successMuted: '#E8F3ED',
  warning: '#A15C00',
  warningMuted: '#FFF2D6',
  danger: '#C4314B',
  dangerPressed: '#A4263C',
  dangerMuted: '#FDE7E9',
  onDanger: '#FFFFFF',
  focus: '#4F6BED',
  focusBackground: '#3347A3',
  focusText: '#FFFFFF',
  focusTextMuted: 'rgba(255, 255, 255, 0.70)',
  focusSurface: 'rgba(255, 255, 255, 0.08)',
  focusSurfaceStrong: 'rgba(255, 255, 255, 0.12)',
  focusBorder: 'rgba(255, 255, 255, 0.14)',
  focusBorderStrong: 'rgba(255, 255, 255, 0.28)',
  focusShadow: 'rgba(10, 18, 44, 0.24)',
  shadow: 'rgba(36, 36, 36, 0.08)',
  overlay: 'rgba(21, 28, 41, 0.48)',
};

const darkColors: AppThemeColors = {
  background: '#111827',
  surface: '#182233',
  surfaceMuted: '#202C3D',
  surfaceElevated: '#1C2738',
  surfacePressed: '#2A384C',
  text: '#F5F7FA',
  textMuted: '#BBC3CF',
  textSubtle: '#8D99AA',
  primary: '#8EA6FF',
  primaryPressed: '#A9BAFF',
  onPrimary: '#111A35',
  primaryMuted: '#2B3A6C',
  onPrimaryMuted: '#D9E0FF',
  border: '#303D50',
  borderStrong: '#46566D',
  divider: '#29364A',
  track: '#344257',
  success: '#79C49A',
  successMuted: '#1D3A2C',
  warning: '#F0BA6A',
  warningMuted: '#44331E',
  danger: '#FF9AA8',
  dangerPressed: '#FFB2BC',
  dangerMuted: '#48262D',
  onDanger: '#3A0D15',
  focus: '#A9BAFF',
  focusBackground: '#111827',
  focusText: '#F5F7FA',
  focusTextMuted: 'rgba(245, 247, 250, 0.70)',
  focusSurface: 'rgba(245, 247, 250, 0.08)',
  focusSurfaceStrong: 'rgba(245, 247, 250, 0.12)',
  focusBorder: 'rgba(245, 247, 250, 0.14)',
  focusBorderStrong: 'rgba(245, 247, 250, 0.28)',
  focusShadow: 'rgba(0, 0, 0, 0.28)',
  shadow: 'rgba(0, 0, 0, 0.24)',
  overlay: 'rgba(5, 10, 20, 0.68)',
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
