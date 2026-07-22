import { prepareAvatarUpload, readAvatarArrayBuffer } from '@/lib/avatar-upload';

const mockNativeArrayBuffer = jest.fn();

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => ({
    arrayBuffer: () => mockNativeArrayBuffer(uri),
  })),
}));

const readerReturning = (buffer: ArrayBuffer) => jest.fn(async () => buffer);

describe('prepareAvatarUpload', () => {
  it('reads the picked image into an ArrayBuffer and keeps the mime type', async () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
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
      readerReturning(new ArrayBuffer(2)),
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
      readerReturning(new ArrayBuffer(2)),
    );

    expect(prepared.contentType).toBe('image/png');
    expect(prepared.fileExtension).toBe('png');
  });

  it('rejects a non-image selection', async () => {
    await expect(prepareAvatarUpload(
      { uri: 'file:///tmp/doc.pdf', mimeType: 'application/pdf' },
      readerReturning(new ArrayBuffer(1)),
    )).rejects.toThrow('Bitte wähle eine Bilddatei aus.');
  });
});
