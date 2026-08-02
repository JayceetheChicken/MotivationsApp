import {
  avatarObjectPathFromUrl,
  avatarUrlReferencesObjectPath,
  cleanupTemporaryAvatarUri,
  MAX_AVATAR_BYTES,
  MAX_AVATAR_DIMENSION,
  prepareAvatarUpload,
  readAvatarArrayBuffer,
} from '@/lib/avatar-upload';

const mockNativeArrayBuffer = jest.fn();
const mockNativeDelete = jest.fn();

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => ({
    arrayBuffer: () => mockNativeArrayBuffer(uri),
    delete: () => mockNativeDelete(uri),
    exists: true,
  })),
}));

const readerReturning = (buffer: ArrayBuffer) => jest.fn(async () => buffer);
const jpeg = (width = 32, height = 32) => new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x07, 0x08,
  (height >> 8) & 0xff, height & 0xff,
  (width >> 8) & 0xff, width & 0xff,
]).buffer;
const png = (width = 32, height = 32) => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes.buffer;
};

describe('prepareAvatarUpload', () => {
  it('extracts only the requested users public Storage object path', () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const path = `${userId}/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
    const url = `https://project.test/storage/v1/object/public/avatars/${path}?v=cache`;

    expect(avatarObjectPathFromUrl(url, userId)).toBe(path);
    expect(avatarObjectPathFromUrl(url, 'other-user')).toBeNull();
    expect(avatarObjectPathFromUrl('https://images.example/avatar.jpg', userId)).toBeNull();
    expect(avatarObjectPathFromUrl(
      `https://project.test/storage/v1/object/public/avatars/${userId}/profile/../foreign.jpg`,
      userId,
    )).toBeNull();
    expect(avatarUrlReferencesObjectPath(url, userId, path)).toBe(true);
  });

  it('reads the picked image into an ArrayBuffer and keeps the mime type', async () => {
    const buffer = png();
    const prepared = await prepareAvatarUpload(
      { uri: 'file:///tmp/pic.png', mimeType: 'image/png' },
      readerReturning(buffer),
    );

    expect(prepared.body).toBeInstanceOf(ArrayBuffer);
    expect(prepared.body).toBe(buffer);
    expect(prepared.contentType).toBe('image/png');
    expect(prepared.fileExtension).toBe('png');
  });

  it('defaults the content type to JPEG without inspecting a Blob', async () => {
    const prepared = await prepareAvatarUpload(
      { uri: 'file:///tmp/pic', mimeType: undefined },
      readerReturning(jpeg()),
    );

    expect(prepared.contentType).toBe('image/jpeg');
    expect(prepared.fileExtension).toBe('jpg');
  });

  it('reports when the image cannot be read locally', async () => {
    await expect(prepareAvatarUpload(
      { uri: 'content://media/pic.jpg', mimeType: 'image/jpeg' },
      readerReturning(new ArrayBuffer(0)),
    )).rejects.toThrow('Das ausgewählte Bild konnte nicht gelesen werden.');

    const rejectingReader = jest.fn(async () => { throw new Error('file unavailable'); });
    await expect(prepareAvatarUpload(
      { uri: 'file:///tmp/pic.jpg', mimeType: 'image/jpeg' },
      rejectingReader,
    )).rejects.toThrow('Das ausgewählte Bild konnte nicht gelesen werden.');
  });

  it('reads Android content URIs through the native File API', async () => {
    const buffer = new Uint8Array([9, 8, 7]).buffer;
    mockNativeArrayBuffer.mockResolvedValueOnce(buffer);

    await expect(readAvatarArrayBuffer('content://media/external/images/42')).resolves.toBe(buffer);
    expect(mockNativeArrayBuffer).toHaveBeenCalledWith('content://media/external/images/42');
  });

  it('infers the image type from the picked filename when Android omits mimeType', async () => {
    const prepared = await prepareAvatarUpload(
      { uri: 'file:///tmp/cropped-image', fileName: 'cropped-image.png' },
      readerReturning(png()),
    );

    expect(prepared.contentType).toBe('image/png');
    expect(prepared.fileExtension).toBe('png');
  });

  it('rejects a non-image selection', async () => {
    await expect(prepareAvatarUpload(
      { uri: 'file:///tmp/doc.pdf', mimeType: 'application/pdf' },
      readerReturning(new ArrayBuffer(1)),
    )).rejects.toThrow('Profilbilder müssen JPEG-, PNG- oder WebP-Dateien sein.');
  });

  it('rejects oversized files before reading and after byte loading', async () => {
    const reader = readerReturning(jpeg());
    await expect(prepareAvatarUpload({
      uri: 'file:///tmp/large.jpg',
      mimeType: 'image/jpeg',
      fileSize: MAX_AVATAR_BYTES + 1,
    }, reader)).rejects.toThrow('höchstens 5 MB');
    expect(reader).not.toHaveBeenCalled();

    await expect(prepareAvatarUpload(
      { uri: 'file:///tmp/large.jpg', mimeType: 'image/jpeg' },
      readerReturning(new ArrayBuffer(MAX_AVATAR_BYTES + 1)),
    )).rejects.toThrow('höchstens 5 MB');
  });

  it('rejects spoofed mime types and unsupported image contents', async () => {
    await expect(prepareAvatarUpload(
      { uri: 'file:///tmp/spoofed.jpg', mimeType: 'image/jpeg' },
      readerReturning(png()),
    )).rejects.toThrow('Dateityp und Bildinhalt stimmen nicht überein.');

    await expect(prepareAvatarUpload(
      { uri: 'file:///tmp/vector.svg', mimeType: 'image/svg+xml' },
      readerReturning(new TextEncoder().encode('<svg/>').buffer),
    )).rejects.toThrow('JPEG-, PNG- oder WebP-Dateien');
  });

  it('rejects decompression-bomb dimensions from metadata and file headers', async () => {
    await expect(prepareAvatarUpload(
      {
        uri: 'file:///tmp/huge.jpg',
        mimeType: 'image/jpeg',
        width: MAX_AVATAR_DIMENSION + 1,
        height: 1,
      },
      readerReturning(jpeg()),
    )).rejects.toThrow('zu große Abmessungen');

    await expect(prepareAvatarUpload(
      { uri: 'file:///tmp/forged.png', mimeType: 'image/png', width: 32, height: 32 },
      readerReturning(png(MAX_AVATAR_DIMENSION + 1, 1)),
    )).rejects.toThrow('beschädigt oder hat zu große Abmessungen');
  });

  it('requires the declared MIME type and file extension to agree', async () => {
    await expect(prepareAvatarUpload(
      { uri: 'file:///tmp/picture.jpg', fileName: 'picture.jpg', mimeType: 'image/png' },
      readerReturning(png()),
    )).rejects.toThrow('JPEG-, PNG- oder WebP-Dateien');
    await expect(prepareAvatarUpload(
      { uri: 'file:///tmp/picture.heic', fileName: 'picture.heic', mimeType: 'image/jpeg' },
      readerReturning(jpeg()),
    )).rejects.toThrow('JPEG-, PNG- oder WebP-Dateien');
  });

  it('deletes only app-cache file copies after an online upload', () => {
    cleanupTemporaryAvatarUri('file:///data/user/0/de.lernzeit.app/cache/picker/avatar.jpg');
    cleanupTemporaryAvatarUri('file:///data/user/0/de.lernzeit.app/files/avatar.jpg');
    cleanupTemporaryAvatarUri('content://media/images/42');
    expect(mockNativeDelete).toHaveBeenCalledTimes(1);
  });
});
