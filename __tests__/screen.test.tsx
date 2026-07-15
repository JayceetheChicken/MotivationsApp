import { Dimensions, StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { Screen } from '@/components/ui/screen';
import { layout, spacing } from '@/theme';

function setWindowWidth(width: number) {
  const dimensions = {
    width,
    height: 900,
    scale: 1,
    fontScale: 1,
  };
  Dimensions.set({ window: dimensions, screen: dimensions });
}

async function contentStyleFor(
  width: number,
  padding?: 'none' | 'compact' | 'default',
) {
  setWindowWidth(width);
  const rendered = await render(
    <Screen padding={padding}>
      <Text>Testinhalt</Text>
    </Screen>,
  );
  const text = rendered.getByText('Testinhalt');
  let current = text.parent;

  while (current) {
    const style = StyleSheet.flatten(current.props.style);
    if (style?.maxWidth === layout.maxContentWidth) {
      await rendered.unmount();
      return style;
    }
    current = current.parent;
  }

  await rendered.unmount();
  throw new Error('Screen content container was not found');
}

describe('Screen responsive padding', () => {
  it.each([
    [layout.phoneBreakpoint - 1, layout.phoneGutter],
    [layout.phoneBreakpoint, layout.tabletGutter],
    [layout.tabletBreakpoint - 1, layout.tabletGutter],
    [layout.tabletBreakpoint, layout.desktopGutter],
  ])('uses the expected gutter at %ipx', async (width, expectedGutter) => {
    expect((await contentStyleFor(width)).paddingHorizontal).toBe(expectedGutter);
  });

  it('lets explicit compact and none padding override responsive gutters', async () => {
    expect((await contentStyleFor(1200, 'compact')).paddingHorizontal).toBe(
      spacing.md,
    );
    expect(await contentStyleFor(1200, 'none')).toMatchObject({
      paddingHorizontal: 0,
      paddingTop: 0,
      paddingBottom: 0,
    });
  });
});
