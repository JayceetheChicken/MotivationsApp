import { Platform } from 'react-native';

import { authStorage } from '@/auth/storage';

const originalPlatformOS = Platform.OS;
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'localStorage',
);

afterEach(() => {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: originalPlatformOS,
  });
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

it('degrades to empty storage during server-side web rendering', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  Reflect.deleteProperty(globalThis, 'localStorage');

  await expect(authStorage.getItem('session')).resolves.toBeNull();
  await expect(authStorage.setItem('session', 'value')).resolves.toBeUndefined();
  await expect(authStorage.removeItem('session')).resolves.toBeUndefined();
});
