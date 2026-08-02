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

it('keeps web auth sessions in memory and never writes localStorage', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  const localStorage = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorage });

  await expect(authStorage.setItem('session', 'value')).resolves.toBeUndefined();
  await expect(authStorage.getItem('session')).resolves.toBe('value');
  await expect(authStorage.removeItem('session')).resolves.toBeUndefined();
  await expect(authStorage.getItem('session')).resolves.toBeNull();
  expect(localStorage.getItem).not.toHaveBeenCalled();
  expect(localStorage.setItem).not.toHaveBeenCalled();
  expect(localStorage.removeItem).not.toHaveBeenCalled();
});
