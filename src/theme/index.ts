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
  primaryText: string;
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
  focusAccent: string;
  focusBackground: string;
  focusText: string;
  focusTextMuted: string;
  focusSurface: string;
  focusSurfaceStrong: string;
  focusBorder: string;
  focusBorderStrong: string;
  focusShadow: string;
  accentPeach: string;
  accentPeachMuted: string;
  accentMustard: string;
  accentMustardMuted: string;
  accentOlive: string;
  accentOliveMuted: string;
  accentTurquoise: string;
  accentTurquoiseMuted: string;
  accentBrown: string;
  accentBrownMuted: string;
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
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
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
  background: '#F4E8D0',
  surface: '#FFF3DC',
  surfaceMuted: '#EAD6B5',
  surfaceElevated: '#FBEBD1',
  surfacePressed: '#DEC39B',
  text: '#3B281D',
  textMuted: '#70513D',
  textSubtle: '#80604C',
  primary: '#B44D2B',
  primaryPressed: '#963B21',
  primaryText: '#8F351B',
  onPrimary: '#FFF0D6',
  primaryMuted: '#F1C4A8',
  onPrimaryMuted: '#73331F',
  border: '#D2B28A',
  borderStrong: '#AF8865',
  divider: '#E5CEAA',
  track: '#DBC6A5',
  success: '#59602F',
  successMuted: '#DDE0B9',
  warning: '#7C5207',
  warningMuted: '#F0D59A',
  danger: '#8F351F',
  dangerPressed: '#82321F',
  dangerMuted: '#EBC2AF',
  onDanger: '#FFF0D6',
  focus: '#C45D35',
  focusAccent: '#D8AD4B',
  focusBackground: '#4A2D24',
  focusText: '#FFF0D6',
  focusTextMuted: 'rgba(255, 240, 214, 0.72)',
  focusSurface: 'rgba(255, 240, 214, 0.08)',
  focusSurfaceStrong: 'rgba(255, 240, 214, 0.14)',
  focusBorder: 'rgba(255, 240, 214, 0.18)',
  focusBorderStrong: 'rgba(255, 240, 214, 0.34)',
  focusShadow: 'rgba(42, 22, 15, 0.30)',
  accentPeach: '#E9A273',
  accentPeachMuted: '#F4D0B8',
  accentMustard: '#7A5109',
  accentMustardMuted: '#F0D59A',
  accentOlive: '#59602F',
  accentOliveMuted: '#DDE0B9',
  accentTurquoise: '#27635D',
  accentTurquoiseMuted: '#C7DDD5',
  accentBrown: '#87593C',
  accentBrownMuted: '#E1C4A6',
  shadow: 'rgba(75, 45, 29, 0.12)',
  overlay: 'rgba(57, 34, 24, 0.58)',
};

const darkColors: AppThemeColors = {
  background: '#2B1D18',
  surface: '#3A2922',
  surfaceMuted: '#463229',
  surfaceElevated: '#402D25',
  surfacePressed: '#573C30',
  text: '#F4E5C6',
  textMuted: '#CBB697',
  textSubtle: '#A99177',
  primary: '#E07A4E',
  primaryPressed: '#EF9065',
  primaryText: '#F09A72',
  onPrimary: '#2B1D18',
  primaryMuted: '#603426',
  onPrimaryMuted: '#F5C3A4',
  border: '#65483A',
  borderStrong: '#84604C',
  divider: '#523A2F',
  track: '#594034',
  success: '#B1B873',
  successMuted: '#3C4028',
  warning: '#D8AD4B',
  warningMuted: '#4E3D1D',
  danger: '#EA8E70',
  dangerPressed: '#F09A7D',
  dangerMuted: '#5A3027',
  onDanger: '#2B1712',
  focus: '#E78960',
  focusAccent: '#D6AD4A',
  focusBackground: '#241713',
  focusText: '#F4E5C6',
  focusTextMuted: 'rgba(244, 229, 198, 0.72)',
  focusSurface: 'rgba(244, 229, 198, 0.08)',
  focusSurfaceStrong: 'rgba(244, 229, 198, 0.14)',
  focusBorder: 'rgba(244, 229, 198, 0.18)',
  focusBorderStrong: 'rgba(244, 229, 198, 0.34)',
  focusShadow: 'rgba(20, 10, 7, 0.40)',
  accentPeach: '#E9A273',
  accentPeachMuted: '#56372C',
  accentMustard: '#D6AD4A',
  accentMustardMuted: '#4E3D1D',
  accentOlive: '#B1B873',
  accentOliveMuted: '#3D4028',
  accentTurquoise: '#70A69E',
  accentTurquoiseMuted: '#293E39',
  accentBrown: '#C18E70',
  accentBrownMuted: '#4E382F',
  shadow: 'rgba(20, 10, 7, 0.34)',
  overlay: 'rgba(20, 11, 8, 0.72)',
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
