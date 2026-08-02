import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

import { StudyRepositoryError } from '@/data/repositories/repository-error';

export interface AvatarSource {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface PreparedAvatar {
  body: ArrayBuffer;
  contentType: string;
  fileExtension: string;
}

export type AvatarArrayBufferReader = (uri: string) => Promise<ArrayBuffer>;
export type AvatarReencodeOperation = (
  uri: string,
  resize: Readonly<{ width?: number; height?: number }> | null,
) => Promise<Readonly<{ uri: string; width: number; height: number }>>;

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const MAX_AVATAR_DIMENSION = 1024;
export const MAX_AVATAR_PIXELS = MAX_AVATAR_DIMENSION * MAX_AVATAR_DIMENSION;
export const MAX_AVATAR_SOURCE_DIMENSION = 8192;

const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PUBLIC_AVATAR_PATH_MARKER = '/storage/v1/object/public/avatars/';

export function avatarObjectPathFromUrl(
  url: string | null | undefined,
  userId: string,
): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (parsed.username || parsed.password || parsed.hash) return null;
    const pathname = decodeURIComponent(parsed.pathname);
    const markerIndex = pathname.indexOf(PUBLIC_AVATAR_PATH_MARKER);
    if (markerIndex < 0) return null;
    const objectPath = pathname.slice(markerIndex + PUBLIC_AVATAR_PATH_MARKER.length);
    const parts = objectPath.split('/');
    if (
      parts.length !== 3
      || parts[0] !== userId
      || parts[1] !== 'profile'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(parts[2])
    ) return null;
    return objectPath;
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

function normalizedMimeType(value: string | null | undefined): string | null {
  return value?.trim().toLowerCase().replace('image/jpg', 'image/jpeg') || null;
}

function declaredExtensionType(asset: AvatarSource): string | null | 'unsupported' {
  const name = asset.fileName?.split(/[?#]/, 1)[0].trim().toLowerCase();
  if (!name || !name.includes('.')) return null;
  if (/\.jpe?g$/.test(name)) return 'image/jpeg';
  if (/\.png$/.test(name)) return 'image/png';
  if (/\.webp$/.test(name)) return 'image/webp';
  return 'unsupported';
}

function extensionFor(contentType: string): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'jpg';
}

async function defaultReencodeAvatar(
  uri: string,
  resize: Readonly<{ width?: number; height?: number }> | null,
): Promise<Readonly<{ uri: string; width: number; height: number }>> {
  const context = ImageManipulator.manipulate(uri);
  if (resize) context.resize(resize);
  const rendered = await context.renderAsync();
  return rendered.saveAsync({ compress: 0.86, format: SaveFormat.JPEG });
}

export async function reencodeAvatarForUpload(
  asset: AvatarSource,
  reencode: AvatarReencodeOperation = defaultReencodeAvatar,
): Promise<AvatarSource> {
  const declaredContentType = normalizedMimeType(asset.mimeType);
  const extensionContentType = declaredExtensionType(asset);
  if (
    (declaredContentType && !ALLOWED_AVATAR_TYPES.has(declaredContentType))
    || extensionContentType === 'unsupported'
    || (declaredContentType && extensionContentType && declaredContentType !== extensionContentType)
  ) {
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
    throw new StudyRepositoryError('invalid_data', 'Das Profilbild darf höchstens 5 MB groß sein.');
  }
  if (
    (asset.width != null && asset.width > MAX_AVATAR_SOURCE_DIMENSION)
    || (asset.height != null && asset.height > MAX_AVATAR_SOURCE_DIMENSION)
  ) {
    throw new StudyRepositoryError('invalid_data', 'Das Profilbild hat zu große Abmessungen.');
  }

  const width = asset.width && asset.width > 0 ? asset.width : null;
  const height = asset.height && asset.height > 0 ? asset.height : null;
  const largestDimension = Math.max(width ?? 0, height ?? 0);
  const resize = width && height && largestDimension > MAX_AVATAR_DIMENSION
    ? width >= height
      ? { width: MAX_AVATAR_DIMENSION }
      : { height: MAX_AVATAR_DIMENSION }
    : null;

  try {
    const result = await reencode(asset.uri, resize);
    if (
      !result.uri
      || !Number.isFinite(result.width)
      || !Number.isFinite(result.height)
      || result.width <= 0
      || result.height <= 0
      || result.width > MAX_AVATAR_DIMENSION
      || result.height > MAX_AVATAR_DIMENSION
    ) throw new Error('Invalid re-encoded dimensions');
    return {
      uri: result.uri,
      mimeType: 'image/jpeg',
      fileName: 'avatar.jpg',
      width: result.width,
      height: result.height,
    };
  } catch (cause) {
    throw new StudyRepositoryError(
      'invalid_data',
      'Das Profilbild konnte nicht sicher neu codiert werden.',
      { cause },
    );
  }
}

export function containsSensitiveImageMetadata(body: ArrayBuffer): boolean {
  const bytes = new Uint8Array(body);
  const signatures = [
    [0x45, 0x78, 0x69, 0x66, 0x00, 0x00], // EXIF
    [0x68, 0x74, 0x74, 0x70, 0x3a, 0x2f, 0x2f, 0x6e, 0x73, 0x2e, 0x61, 0x64, 0x6f, 0x62, 0x65], // XMP
    [0x47, 0x50, 0x53, 0x49, 0x46, 0x44], // GPSIFD marker in test/diagnostic payloads
  ];
  return signatures.some((signature) => {
    for (let offset = 0; offset <= bytes.length - signature.length; offset += 1) {
      if (signature.every((value, index) => bytes[offset + index] === value)) return true;
    }
    return false;
  });
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

interface ImageDimensions {
  width: number;
  height: number;
}

function uint16BigEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 256 + bytes[offset + 1];
}

function detectPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.length < 24
    || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR'
  ) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function detectJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda || offset + 2 > bytes.length) return null;
    const segmentLength = uint16BigEndian(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) return null;
      return {
        height: uint16BigEndian(bytes, offset + 3),
        width: uint16BigEndian(bytes, offset + 5),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function detectWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 25) return null;
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return {
      width: 1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65_536,
      height: 1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65_536,
    };
  }
  if (
    chunk === 'VP8 '
    && bytes.length >= 30
    && bytes[23] === 0x9d
    && bytes[24] === 0x01
    && bytes[25] === 0x2a
  ) {
    return {
      width: (bytes[26] + bytes[27] * 256) & 0x3fff,
      height: (bytes[28] + bytes[29] * 256) & 0x3fff,
    };
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    return {
      width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
    };
  }
  return null;
}

function detectedDimensions(body: ArrayBuffer, contentType: string): ImageDimensions | null {
  const bytes = new Uint8Array(body);
  if (contentType === 'image/png') return detectPngDimensions(bytes);
  if (contentType === 'image/jpeg') return detectJpegDimensions(bytes);
  if (contentType === 'image/webp') return detectWebpDimensions(bytes);
  return null;
}

function validDimensions(dimensions: ImageDimensions): boolean {
  return Number.isInteger(dimensions.width)
    && Number.isInteger(dimensions.height)
    && dimensions.width > 0
    && dimensions.height > 0
    && dimensions.width <= MAX_AVATAR_DIMENSION
    && dimensions.height <= MAX_AVATAR_DIMENSION
    && dimensions.width * dimensions.height <= MAX_AVATAR_PIXELS;
}

/** Removes only app-cache files; provider and library originals are untouched. */
export function cleanupTemporaryAvatarUri(uri: string): void {
  if (Platform.OS === 'web' || !/^file:\/\//i.test(uri) || !/[\\/]cache[\\/]/i.test(uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // The operating system may already have reclaimed the picker cache entry.
  }
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
  const declaredContentType = normalizedMimeType(asset.mimeType);
  const extensionContentType = declaredExtensionType(asset);
  if (
    (declaredContentType && !ALLOWED_AVATAR_TYPES.has(declaredContentType))
    || extensionContentType === 'unsupported'
    || (declaredContentType && extensionContentType && declaredContentType !== extensionContentType)
  ) {
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
  if (
    (asset.width != null && asset.width > 0 && asset.width > MAX_AVATAR_DIMENSION)
    || (asset.height != null && asset.height > 0 && asset.height > MAX_AVATAR_DIMENSION)
    || (
      asset.width != null && asset.width > 0
      && asset.height != null && asset.height > 0
      && asset.width * asset.height > MAX_AVATAR_PIXELS
    )
  ) {
    throw new StudyRepositoryError(
      'invalid_data',
      'Das Profilbild hat zu große Abmessungen.',
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
  if (containsSensitiveImageMetadata(body)) {
    throw new StudyRepositoryError(
      'invalid_data',
      'Das Profilbild enthält unerwartete Metadaten und wurde nicht hochgeladen.',
    );
  }
  const detectedType = detectedContentType(body);
  if (!detectedType) {
    throw new StudyRepositoryError(
      'invalid_data',
      'Die ausgewählte Datei enthält kein unterstütztes JPEG-, PNG- oder WebP-Bild.',
    );
  }
  if (
    (declaredContentType && detectedType !== declaredContentType)
    || (extensionContentType && extensionContentType !== detectedType)
  ) {
    throw new StudyRepositoryError(
      'invalid_data',
      'Dateityp und Bildinhalt stimmen nicht überein.',
    );
  }

  const dimensions = detectedDimensions(body, detectedType);
  if (!dimensions || !validDimensions(dimensions)) {
    throw new StudyRepositoryError(
      'invalid_data',
      'Das Profilbild ist beschädigt oder hat zu große Abmessungen.',
    );
  }

  const contentType = detectedType;
  const fileExtension = extensionFor(contentType);

  return { body, contentType, fileExtension };
}
