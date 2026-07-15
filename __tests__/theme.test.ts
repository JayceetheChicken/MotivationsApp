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
    'uses a blue-dominant primary instead of a green primary in $mode mode',
    (theme) => {
      const [red, green, blue] = rgb(theme.colors.primary);

      expect(blue).toBeGreaterThan(green);
      expect(blue).toBeGreaterThan(red);
      expect(theme.colors.primary).not.toBe(theme.colors.success);
      expect(theme.colors.focus).not.toBe(theme.colors.success);
      expect(theme.colors.onPrimary).not.toBe(theme.colors.primary);
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
