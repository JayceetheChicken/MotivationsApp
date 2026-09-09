import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { authStorage } from '@/auth/storage';

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn(async () => undefined),
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

const originalPlatformOS = Platform.OS;
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'localStorage',
);

afterEach(() => {
  jest.clearAllMocks();
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

it('sweeps every native chunk even when chunk metadata is missing or corrupt', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  const deleteItemAsync = jest.mocked(SecureStore.deleteItemAsync);

  await expect(authStorage.removeItem('session')).resolves.toBeUndefined();

  expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
  expect(deleteItemAsync).toHaveBeenCalledTimes(130);
  expect(deleteItemAsync).toHaveBeenCalledWith('session', { keychainService: 'lernzeit.auth' });
  expect(deleteItemAsync).toHaveBeenCalledWith(
    'session.__chunks',
    { keychainService: 'lernzeit.auth' },
  );
  for (let index = 0; index < 128; index += 1) {
    expect(deleteItemAsync).toHaveBeenCalledWith(
      `session.__chunk.${index}`,
      { keychainService: 'lernzeit.auth' },
    );
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
