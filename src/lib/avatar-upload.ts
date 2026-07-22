import { StudyRepositoryError } from '@/data/repositories/repository-error';

export interface AvatarSource {
  uri: string;
  mimeType?: string | null;
}

export interface PreparedAvatar {
  body: ArrayBuffer;
  contentType: string;
  fileExtension: string;
}

/**
 * Reads a picked image into an ArrayBuffer. Supabase Storage does not reliably
 * accept a Blob on React Native, so the raw bytes are passed through instead.
 * The content type is derived from the picker's mimeType only (never from a
 * Blob), defaulting to JPEG.
 */
export async function prepareAvatarUpload(
  asset: AvatarSource,
  fetchImpl: typeof fetch = fetch,
): Promise<PreparedAvatar> {
  let body: ArrayBuffer;
  try {
    const response = await fetchImpl(asset.uri);
    if (!response.ok) {
      throw new Error(`Bild-Antwort mit Status ${response.status}`);
    }
    body = await response.arrayBuffer();
  } catch (readError) {
    throw new StudyRepositoryError(
      'invalid_data',
      'Das ausgewählte Bild konnte nicht gelesen werden.',
      { cause: readError },
    );
  }

  const contentType = asset.mimeType?.trim() || 'image/jpeg';
  if (!contentType.startsWith('image/')) {
    throw new StudyRepositoryError('invalid_data', 'Bitte wähle eine Bilddatei aus.');
  }

  const fileExtension = contentType === 'image/png'
    ? 'png'
    : contentType === 'image/webp'
      ? 'webp'
      : 'jpg';

  return { body, contentType, fileExtension };
}
