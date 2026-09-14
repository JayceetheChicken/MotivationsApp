import type { PropsWithChildren } from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { OnlineAccountBoundary } from '@/auth/online-account-boundary';
import { useAuthStore } from '@/state/auth-store';

jest.mock('@/auth/backend-policy', () => ({ ONLINE_BACKEND_REQUIRED: true }));
jest.mock('@/state/auth-store', () => ({ useAuthStore: jest.fn() }));
jest.mock('expo-router/stack', () => {
  const Stack = ({ children }: PropsWithChildren) => children;
  Stack.Screen = () => null;
  Stack.Protected = ({ children, guard }: PropsWithChildren<{ guard: boolean }>) => guard ? children : null;
  return { Stack };
});
const setAuth = (values: Record<string, unknown>) => jest.mocked(useAuthStore).mockReturnValue({
  configuration: { isConfigured: true }, hydrated: true, session: null, ...values,
} as unknown as ReturnType<typeof useAuthStore>);

describe('online APK account boundary', () => {
  const storeMounted = jest.fn();
  function StudyArea() {
    storeMounted();
    return <Text>Account data</Text>;
  }
  beforeEach(() => storeMounted.mockClear());

  it.each([
    {},
    { hydrated: false },
    { localProfile: { displayName: 'Old local account' }, activeMode: 'local' },
    { configuration: { isConfigured: false } },
  ])('never mounts a local study store before a valid online session %#', async (auth) => {
    setAuth(auth);
    await render(<OnlineAccountBoundary><StudyArea /></OnlineAccountBoundary>);
    expect(storeMounted).not.toHaveBeenCalled();
  });

  it('unmounts account data on sign-out instead of switching to guest storage', async () => {
    setAuth({ session: { user: { id: 'account-a' } } });
    const view = await render(<OnlineAccountBoundary><StudyArea /></OnlineAccountBoundary>);
    expect(view.getByText('Account data')).toBeTruthy();
    setAuth({ session: null });
    await view.rerender(<OnlineAccountBoundary><StudyArea /></OnlineAccountBoundary>);
    expect(view.queryByText('Account data')).toBeNull();
  });
});
