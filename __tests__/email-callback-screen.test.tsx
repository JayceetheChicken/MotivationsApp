import { render, screen } from '@testing-library/react-native';
import EmailCallbackScreen from '@/app/auth/callback';

let mockAuth = { hydrated: true, emailCallbackPending: false, session: null as object | null };
jest.mock('@/state/auth-store', () => ({ useAuthStore: () => mockAuth }));
jest.mock('@/auth/auth-ui', () => ({ AuthScaffold: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('expo-router', () => ({ Redirect: ({ href }: { href: string }) => {
  const { Text } = jest.requireActual('react-native');
  return <Text>{href}</Text>;
} }));

beforeEach(() => { mockAuth = { hydrated: true, emailCallbackPending: false, session: null }; });
it('shows progress until the code exchange completes', async () => {
  mockAuth.emailCallbackPending = true;
  await render(<EmailCallbackScreen />);
  expect(screen.getByLabelText('E-Mail-Bestätigung wird geprüft')).toBeTruthy();
});
it('returns to login after invalid links or confirmation on another device', async () => {
  await render(<EmailCallbackScreen />);
  expect(screen.getByText('/login')).toBeTruthy();
});
it('opens the authenticated app after successful session creation', async () => {
  mockAuth.session = {};
  await render(<EmailCallbackScreen />);
  expect(screen.getByText('/')).toBeTruthy();
});
