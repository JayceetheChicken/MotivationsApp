import {
  avatarObjectPathFromUrl,
  avatarUrlReferencesObjectPath,
  MAX_AVATAR_BYTES,
  prepareAvatarUpload,
  readAvatarArrayBuffer,
} from '@/lib/avatar-upload';

const mockNativeArrayBuffer = jest.fn();

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => ({
    arrayBuffer: () => mockNativeArrayBuffer(uri),
  })),
}));

const readerReturning = (buffer: ArrayBuffer) => jest.fn(async () => buffer);
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer;
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;

describe('prepareAvatarUpload', () => {
  it('extracts only the requested users public Storage object path', () => {
    const path = 'user-123/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg';
    const url = `https://project.test/storage/v1/object/public/avatars/${path}?v=cache`;

    expect(avatarObjectPathFromUrl(url, 'user-123')).toBe(path);
    expect(avatarObjectPathFromUrl(url, 'other-user')).toBeNull();
    expect(avatarObjectPathFromUrl('https://images.example/avatar.jpg', 'user-123')).toBeNull();
    expect(avatarUrlReferencesObjectPath(url, 'user-123', path)).toBe(true);
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
});
