import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { withTimeout } from '@/lib/with-timeout';

export interface AsyncKeyValueStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

// A small character limit also stays below older SecureStore byte limits for Unicode text.
const CHUNK_SIZE = 450;
const MAX_CHUNKS = 128;
// A hanging or corrupt SecureStore must degrade to "no stored value" so the
// app (and Supabase's session restore) can continue as a guest.
const READ_TIMEOUT_MS = 4000;
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainService: 'lernzeit.auth',
};

function getWebStorage(): Storage {
  if (typeof globalThis.localStorage === 'undefined') {
    throw new Error('Lokaler Browser-Speicher ist nicht verfügbar.');
  }

  return globalThis.localStorage;
}

function chunkMetaKey(key: string): string {
  return `${key}.__chunks`;
}

function chunkKey(key: string, index: number): string {
  return `${key}.__chunk.${index}`;
}

function parseChunkCount(rawValue: string | null): number | null {
  if (!rawValue) return null;

  const count = Number(rawValue);
  return Number.isInteger(count) && count > 0 && count <= MAX_CHUNKS ? count : null;
}

async function getNativeItem(key: string): Promise<string | null> {
  const chunkCount = parseChunkCount(
    await SecureStore.getItemAsync(chunkMetaKey(key), secureStoreOptions),
  );

  if (!chunkCount) {
    return SecureStore.getItemAsync(key, secureStoreOptions);
  }

  const chunks = await Promise.all(
    Array.from({ length: chunkCount }, (_, index) =>
      SecureStore.getItemAsync(chunkKey(key, index), secureStoreOptions),
    ),
  );

  if (chunks.some((chunk) => chunk === null)) {
    return null;
  }

  return chunks.join('');
}

async function setNativeItem(key: string, value: string): Promise<void> {
  const previousChunkCount = parseChunkCount(
    await SecureStore.getItemAsync(chunkMetaKey(key), secureStoreOptions),
  ) ?? 0;
  const chunks = value.match(new RegExp(`.{1,${CHUNK_SIZE}}`, 'gs')) ?? [''];

  if (chunks.length > MAX_CHUNKS) {
    throw new Error('Der sicher gespeicherte Anmeldestatus ist unerwartet groß.');
  }

  await Promise.all(
    chunks.map((chunk, index) =>
      SecureStore.setItemAsync(chunkKey(key, index), chunk, secureStoreOptions),
    ),
  );

  if (previousChunkCount > chunks.length) {
    await Promise.all(
      Array.from({ length: previousChunkCount - chunks.length }, (_, offset) =>
        SecureStore.deleteItemAsync(chunkKey(key, chunks.length + offset), secureStoreOptions),
      ),
    );
  }

  await SecureStore.deleteItemAsync(key, secureStoreOptions);
  await SecureStore.setItemAsync(
    chunkMetaKey(key),
    String(chunks.length),
    secureStoreOptions,
  );
}

async function removeNativeItem(key: string): Promise<void> {
  const chunkCount = parseChunkCount(
    await SecureStore.getItemAsync(chunkMetaKey(key), secureStoreOptions),
  ) ?? 0;

  await Promise.all([
    SecureStore.deleteItemAsync(key, secureStoreOptions),
    SecureStore.deleteItemAsync(chunkMetaKey(key), secureStoreOptions),
    ...Array.from({ length: chunkCount }, (_, index) =>
      SecureStore.deleteItemAsync(chunkKey(key, index), secureStoreOptions),
    ),
  ]);
}

export const authStorage: AsyncKeyValueStorage = {
  async getItem(key) {
    if (Platform.OS === 'web') {
      return getWebStorage().getItem(key);
    }

    try {
      return await withTimeout(getNativeItem(key), READ_TIMEOUT_MS, `SecureStore-Lesezugriff „${key}“`);
    } catch (error) {
      console.warn('SecureStore-Lesezugriff fehlgeschlagen – Wert wird als leer behandelt.', error);
      return null;
    }
  },
  async setItem(key, value) {
    if (Platform.OS === 'web') {
      getWebStorage().setItem(key, value);
      return;
    }

    await setNativeItem(key, value);
  },
  async removeItem(key) {
    if (Platform.OS === 'web') {
      getWebStorage().removeItem(key);
      return;
    }

    await removeNativeItem(key);
  },
};
