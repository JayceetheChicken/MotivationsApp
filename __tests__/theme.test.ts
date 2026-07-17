import { appTheme, layout } from '@/theme';

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

describe('application theme', () => {
  it('exposes a single light retro theme with a bright warm background', () => {
    const [red, green, blue] = rgb(appTheme.colors.background);

    expect(relativeLuminance(appTheme.colors.background)).toBeGreaterThan(0.5);
    expect(red).toBeGreaterThanOrEqual(green);
    expect(green).toBeGreaterThanOrEqual(blue);
    expect(relativeLuminance(appTheme.colors.text)).toBeLessThan(0.1);
  });

  it('uses a terracotta-dominant primary', () => {
    const [red, green, blue] = rgb(appTheme.colors.primary);

    expect(red).toBeGreaterThan(green);
    expect(red).toBeGreaterThan(blue);
    expect(appTheme.colors.primary).not.toBe(appTheme.colors.success);
    expect(appTheme.colors.focus).not.toBe(appTheme.colors.success);
    expect(appTheme.colors.onPrimary).not.toBe(appTheme.colors.primary);
  });

  it('provides restrained retro accents without pure white or black', () => {
    expect(appTheme.colors.accentMustard).not.toBe(appTheme.colors.primary);
    expect(appTheme.colors.accentOlive).not.toBe(appTheme.colors.primary);
    expect(appTheme.colors.accentTurquoise).not.toBe(appTheme.colors.primary);
    expect(appTheme.colors.accentPeach).not.toBe(appTheme.colors.primary);

    Object.values(appTheme.colors).forEach((color) => {
      expect(color.toUpperCase()).not.toBe('#FFFFFF');
      expect(color.toUpperCase()).not.toBe('#000000');
    });
  });

  it('keeps essential text and accent combinations readable', () => {
    const foregroundPairs = [
      [appTheme.colors.text, appTheme.colors.background],
      [appTheme.colors.textMuted, appTheme.colors.background],
      [appTheme.colors.onPrimary, appTheme.colors.primary],
      [appTheme.colors.primaryText, appTheme.colors.surfaceElevated],
      [appTheme.colors.primaryText, appTheme.colors.accentPeachMuted],
      [appTheme.colors.accentMustard, appTheme.colors.surfaceElevated],
      [appTheme.colors.accentOlive, appTheme.colors.accentOliveMuted],
      [appTheme.colors.accentTurquoise, appTheme.colors.surfaceElevated],
      [appTheme.colors.accentBrown, appTheme.colors.surface],
      [appTheme.colors.danger, appTheme.colors.dangerMuted],
      [appTheme.colors.focusAccent, appTheme.colors.focusBackground],
    ] as const;

    foregroundPairs.forEach(([foreground, background]) => {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    });
  });
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
