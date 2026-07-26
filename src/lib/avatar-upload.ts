import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { StudyRepositoryError } from '@/data/repositories/repository-error';

export interface AvatarSource {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
}

export interface PreparedAvatar {
  body: ArrayBuffer;
  contentType: string;
  fileExtension: string;
}

export type AvatarArrayBufferReader = (uri: string) => Promise<ArrayBuffer>;

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PUBLIC_AVATAR_PATH_MARKER = '/storage/v1/object/public/avatars/';

export function avatarObjectPathFromUrl(
  url: string | null | undefined,
  userId: string,
): string | null {
  if (!url) return null;
  try {
    const pathname = decodeURIComponent(new URL(url).pathname);
    const markerIndex = pathname.indexOf(PUBLIC_AVATAR_PATH_MARKER);
    if (markerIndex < 0) return null;
    const objectPath = pathname.slice(markerIndex + PUBLIC_AVATAR_PATH_MARKER.length);
    return objectPath.startsWith(`${userId}/`) ? objectPath : null;
  } catch {
    return null;
  }
}

export function avatarUrlReferencesObjectPath(
  url: string | null | undefined,
  userId: string,
  objectPath: string,
): boolean {
  return avatarObjectPathFromUrl(url, userId) === objectPath;
}

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
  const suppliedType = asset.mimeType?.trim().toLowerCase().replace('image/jpg', 'image/jpeg');
  if (suppliedType) return suppliedType;

  const name = (asset.fileName || asset.uri).split(/[?#]/, 1)[0].toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function extensionFor(contentType: string): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'jpg';
}

function detectedContentType(body: ArrayBuffer): string | null {
  const bytes = new Uint8Array(body);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Reads a picked image into an ArrayBuffer. Supabase Storage does not reliably
 * accept a Blob on React Native, so the raw bytes are passed through instead.
 * The file is accepted only when its byte signature is JPEG, PNG, or WebP.
 * Supplied picker metadata is treated as an additional consistency check.
 */
export async function prepareAvatarUpload(
  asset: AvatarSource,
  readArrayBuffer: AvatarArrayBufferReader = readAvatarArrayBuffer,
): Promise<PreparedAvatar> {
  const declaredContentType = contentTypeFor(asset);
  if (!ALLOWED_AVATAR_TYPES.has(declaredContentType)) {
    throw new StudyRepositoryError(
      'invalid_data',
      'Profilbilder müssen JPEG-, PNG- oder WebP-Dateien sein.',
    );
  }
  if (asset.fileSize != null && (
    !Number.isFinite(asset.fileSize)
    || asset.fileSize <= 0
    || asset.fileSize > MAX_AVATAR_BYTES
  )) {
    throw new StudyRepositoryError(
      'invalid_data',
      'Das Profilbild darf höchstens 5 MB groß sein.',
    );
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

  if (body.byteLength > MAX_AVATAR_BYTES) {
    throw new StudyRepositoryError(
      'invalid_data',
      'Das Profilbild darf höchstens 5 MB groß sein.',
    );
  }
  const detectedType = detectedContentType(body);
  if (!detectedType) {
    throw new StudyRepositoryError(
      'invalid_data',
      'Die ausgewählte Datei enthält kein unterstütztes JPEG-, PNG- oder WebP-Bild.',
    );
  }
  if (asset.mimeType && detectedType !== declaredContentType) {
    throw new StudyRepositoryError(
      'invalid_data',
      'Dateityp und Bildinhalt stimmen nicht überein.',
    );
  }

  const contentType = detectedType;
  const fileExtension = extensionFor(contentType);

  return { body, contentType, fileExtension };
}
