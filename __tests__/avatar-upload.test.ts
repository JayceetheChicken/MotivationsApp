import { prepareAvatarUpload } from '@/lib/avatar-upload';

function fetchReturning(buffer: ArrayBuffer, ok = true, status = 200): typeof fetch {
  return jest.fn(async () => ({
    ok,
    status,
    arrayBuffer: async () => buffer,
  })) as unknown as typeof fetch;
}

describe('prepareAvatarUpload', () => {
  it('reads the picked image into an ArrayBuffer and keeps the mime type', async () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const prepared = await prepareAvatarUpload(
      { uri: 'file:///tmp/pic.png', mimeType: 'image/png' },
      fetchReturning(buffer),
    );

    expect(prepared.body).toBeInstanceOf(ArrayBuffer);
    expect(prepared.body).toBe(buffer);
    expect(prepared.contentType).toBe('image/png');
    expect(prepared.fileExtension).toBe('png');
  });

  it('defaults the content type to JPEG without inspecting a Blob', async () => {
    const prepared = await prepareAvatarUpload(
      { uri: 'file:///tmp/pic', mimeType: undefined },
      fetchReturning(new ArrayBuffer(2)),
    );

    expect(prepared.contentType).toBe('image/jpeg');
    expect(prepared.fileExtension).toBe('jpg');
  });

  it('reports when the image cannot be read locally', async () => {
    await expect(prepareAvatarUpload(
      { uri: 'file:///tmp/pic.jpg', mimeType: 'image/jpeg' },
      fetchReturning(new ArrayBuffer(0), false, 404),
    )).rejects.toThrow('Das ausgewählte Bild konnte nicht gelesen werden.');

    const rejectingFetch = jest.fn(async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    await expect(prepareAvatarUpload(
      { uri: 'file:///tmp/pic.jpg', mimeType: 'image/jpeg' },
      rejectingFetch,
    )).rejects.toThrow('Das ausgewählte Bild konnte nicht gelesen werden.');
  });

  it('rejects a non-image selection', async () => {
    await expect(prepareAvatarUpload(
      { uri: 'file:///tmp/doc.pdf', mimeType: 'application/pdf' },
      fetchReturning(new ArrayBuffer(1)),
    )).rejects.toThrow('Bitte wähle eine Bilddatei aus.');
  });
});
