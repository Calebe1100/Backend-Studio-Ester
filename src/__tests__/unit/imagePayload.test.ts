import { HttpError } from '../../lib/httpError';
import { MAX_IMAGE_BYTES, parseImagePayload } from '../../lib/imagePayload';

function jpeg(size = 8): Buffer {
  const bytes = Buffer.alloc(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  return bytes;
}

function png(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
}

function webp(): Buffer {
  const bytes = Buffer.alloc(12);
  bytes.write('RIFF', 0);
  bytes.write('WEBP', 8);
  return bytes;
}

function payload(bytes: Buffer, contentType: string) {
  return { contentType, dataBase64: bytes.toString('base64') };
}

describe('parseImagePayload', () => {
  it('aceita JPEG, PNG e WebP pelos bytes iniciais', () => {
    expect(parseImagePayload(payload(jpeg(), 'image/jpeg')).contentType).toBe('image/jpeg');
    expect(parseImagePayload(payload(png(), 'image/png')).contentType).toBe('image/png');
    expect(parseImagePayload(payload(webp(), 'image/webp')).contentType).toBe('image/webp');
  });

  it('trata image/jpg como JPEG', () => {
    expect(parseImagePayload(payload(jpeg(), 'image/jpg')).contentType).toBe('image/jpeg');
  });

  it('recusa tipo declarado diferente dos bytes', () => {
    expect(() => parseImagePayload(payload(png(), 'image/jpeg'))).toThrow(HttpError);
  });

  it('recusa arquivo que não é imagem', () => {
    const html = Buffer.from('<html></html>');
    expect(() => parseImagePayload(payload(html, 'image/png'))).toThrow(
      'O arquivo não corresponde ao tipo informado.',
    );
  });

  it('recusa imagem acima de 500 KB', () => {
    expect(() => parseImagePayload(payload(jpeg(MAX_IMAGE_BYTES + 1), 'image/jpeg'))).toThrow(
      'A imagem deve ter no máximo 500 KB.',
    );
  });

  it('recusa payload vazio ou sem os campos', () => {
    expect(() => parseImagePayload(null)).toThrow('Imagem inválida.');
    expect(() => parseImagePayload({ contentType: 'image/jpeg' })).toThrow('Imagem inválida.');
    expect(() => parseImagePayload({ contentType: 'image/jpeg', dataBase64: '' })).toThrow(
      'Imagem inválida.',
    );
  });
});
