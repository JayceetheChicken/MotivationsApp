import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { StudyRepositoryError } from '@/data/repositories/repository-error';

export interface AvatarSource {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
}

export interface PreparedAvatar {
  body: ArrayBuffer;
  contentType: string;
  fileExtension: string;
}

export type AvatarArrayBufferReader = (uri: string) => Promise<ArrayBuffer>;

/**
 * ImagePicker exports Android selections into the app cache. Reading that
 * `file://` (or provider `content://`) URI through the native File API is more
 * reliable than sending it through React Native's network fetch stack.
 */
export async function readAvatarArrayBuffer(uri: string): Promise<ArrayBuffer> {
  if (Platform.OS !== 'web') {
    return new File(uri).arrayBuffer();
  }

  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`Bild-Antwort mit Status ${response.status}`);
  }
  return response.arrayBuffer();
}

function contentTypeFor(asset: AvatarSource): string {
  const suppliedType = asset.mimeType?.trim().toLowerCase();
  if (suppliedType) return suppliedType;

  const name = (asset.fileName || asset.uri).split(/[?#]/, 1)[0].toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.heic') || name.endsWith('.heif')) return 'image/heic';
  return 'image/jpeg';
}

function extensionFor(contentType: string): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/gif') return 'gif';
  if (contentType === 'image/heic' || contentType === 'image/heif') return 'heic';
  return 'jpg';
}

/**
 * Reads a picked image into an ArrayBuffer. Supabase Storage does not reliably
 * accept a Blob on React Native, so the raw bytes are passed through instead.
 * The content type is derived from the picker's mimeType only (never from a
 * Blob), defaulting to JPEG.
 */
export async function prepareAvatarUpload(
  asset: AvatarSource,
  readArrayBuffer: AvatarArrayBufferReader = readAvatarArrayBuffer,
): Promise<PreparedAvatar> {
  const contentType = contentTypeFor(asset);
  if (!contentType.startsWith('image/')) {
    throw new StudyRepositoryError('invalid_data', 'Bitte wähle eine Bilddatei aus.');
  }

  let body: ArrayBuffer;
  try {
    body = await readArrayBuffer(asset.uri);
    if (body.byteLength === 0) throw new Error('Die Bilddatei ist leer.');
  } catch (readError) {
    throw new StudyRepositoryError(
      'invalid_data',
      'Das ausgewählte Bild konnte nicht gelesen werden.',
      { cause: readError },
    );
  }

  const fileExtension = extensionFor(contentType);

  return { body, contentType, fileExtension };
}
