import {
  darkTheme,
  getAppTheme,
  layout,
  lightTheme,
  themes,
} from '@/theme';

function rgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`Expected a six-digit hex colour, received ${hex}`);
  }
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const channels = rgb(hex).map((channel) => channel / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);

  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

describe('application themes', () => {
  it('exposes complete and distinct light and dark modes', () => {
    expect(getAppTheme('light')).toBe(lightTheme);
    expect(getAppTheme('dark')).toBe(darkTheme);
    expect(themes).toEqual({ light: lightTheme, dark: darkTheme });
    expect(lightTheme.mode).toBe('light');
    expect(lightTheme.isDark).toBe(false);
    expect(darkTheme.mode).toBe('dark');
    expect(darkTheme.isDark).toBe(true);
    expect(lightTheme.colors.background).not.toBe(darkTheme.colors.background);
    expect(lightTheme.colors.text).not.toBe(darkTheme.colors.text);
  });

  it.each([lightTheme, darkTheme])(
    'uses a terracotta-dominant primary in $mode mode',
    (theme) => {
      const [red, green, blue] = rgb(theme.colors.primary);

      expect(red).toBeGreaterThan(green);
      expect(red).toBeGreaterThan(blue);
      expect(theme.colors.primary).not.toBe(theme.colors.success);
      expect(theme.colors.focus).not.toBe(theme.colors.success);
      expect(theme.colors.onPrimary).not.toBe(theme.colors.primary);
    },
  );

  it.each([lightTheme, darkTheme])(
    'provides restrained retro accents without pure white or black in $mode mode',
    (theme) => {
      expect(theme.colors.accentMustard).not.toBe(theme.colors.primary);
      expect(theme.colors.accentOlive).not.toBe(theme.colors.primary);
      expect(theme.colors.accentTurquoise).not.toBe(theme.colors.primary);
      expect(theme.colors.accentPeach).not.toBe(theme.colors.primary);

      Object.values(theme.colors).forEach((color) => {
        expect(color.toUpperCase()).not.toBe('#FFFFFF');
        expect(color.toUpperCase()).not.toBe('#000000');
      });
    },
  );

  it.each([lightTheme, darkTheme])(
    'keeps essential text and accent combinations readable in $mode mode',
    (theme) => {
      const foregroundPairs = [
        [theme.colors.text, theme.colors.background],
        [theme.colors.textMuted, theme.colors.background],
        [theme.colors.onPrimary, theme.colors.primary],
        [theme.colors.primaryText, theme.colors.surfaceElevated],
        [theme.colors.primaryText, theme.colors.accentPeachMuted],
        [theme.colors.accentMustard, theme.colors.surfaceElevated],
        [theme.colors.accentOlive, theme.colors.accentOliveMuted],
        [theme.colors.accentTurquoise, theme.colors.surfaceElevated],
        [theme.colors.accentBrown, theme.colors.surface],
        [theme.colors.danger, theme.colors.dangerMuted],
        [theme.colors.focusAccent, theme.colors.focusBackground],
      ] as const;

      foregroundPairs.forEach(([foreground, background]) => {
        expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
      });
    },
  );
});

describe('responsive layout tokens', () => {
  it('orders phone, tablet and maximum content breakpoints', () => {
    expect(layout.phoneBreakpoint).toBeGreaterThanOrEqual(480);
    expect(layout.phoneBreakpoint).toBeLessThan(layout.tabletBreakpoint);
    expect(layout.tabletBreakpoint).toBeLessThan(layout.maxContentWidth);
  });

  it('increases gutters with available space and keeps touch targets accessible', () => {
    expect(layout.phoneGutter).toBeLessThan(layout.tabletGutter);
    expect(layout.tabletGutter).toBeLessThan(layout.desktopGutter);
    expect(layout.minTouchTarget).toBeGreaterThanOrEqual(44);
  });
});
