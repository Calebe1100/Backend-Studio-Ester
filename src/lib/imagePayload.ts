import { HttpError } from './httpError';

/** Tamanho máximo já decodificado. O JSON cabe no limite de 1 MB do Express. */
export const MAX_IMAGE_BYTES = 500 * 1024;

export type ImageContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export type StoredImage = {
  bytes: Buffer;
  contentType: ImageContentType;
};

const SIGNATURES: Array<{ type: ImageContentType; matches: (bytes: Buffer) => boolean }> = [
  {
    type: 'image/jpeg',
    matches: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    type: 'image/png',
    matches: (bytes) =>
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a,
  },
  {
    type: 'image/webp',
    matches: (bytes) =>
      bytes.length >= 12 &&
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP',
  },
];

function declaredType(value: unknown): ImageContentType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'image/jpg' || normalized === 'image/jpeg') return 'image/jpeg';
  if (normalized === 'image/png') return 'image/png';
  if (normalized === 'image/webp') return 'image/webp';
  return null;
}

function decodeBase64(value: unknown): Buffer {
  if (typeof value !== 'string') throw new HttpError(400, 'Imagem inválida.');
  const trimmed = value.trim();
  const payload = trimmed.startsWith('data:')
    ? trimmed.slice(trimmed.indexOf(',') + 1).trim()
    : trimmed;
  if (!payload || !/^[A-Za-z0-9+/=\s]+$/.test(payload)) {
    throw new HttpError(400, 'Imagem inválida.');
  }
  return Buffer.from(payload, 'base64');
}

export function detectImageType(bytes: Buffer): ImageContentType | null {
  return SIGNATURES.find((item) => item.matches(bytes))?.type ?? null;
}

/** Confere o tipo pelos bytes iniciais e recusa arquivo maior que o limite. */
export function parseImagePayload(input: unknown): StoredImage {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'Imagem inválida.');
  const body = input as { contentType?: unknown; dataBase64?: unknown };
  const contentType = declaredType(body.contentType);
  if (!contentType) throw new HttpError(400, 'Use uma imagem JPEG, PNG ou WebP.');

  const bytes = decodeBase64(body.dataBase64);
  if (bytes.length === 0) throw new HttpError(400, 'Imagem inválida.');
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new HttpError(400, 'A imagem deve ter no máximo 500 KB.');
  }

  const detected = detectImageType(bytes);
  if (!detected || detected !== contentType) {
    throw new HttpError(400, 'O arquivo não corresponde ao tipo informado.');
  }
  return { bytes, contentType };
}

/**
 * `undefined` mantém a imagem atual.
 * `null` remove.
 * Objeto substitui, depois da validação.
 */
export function readOptionalImage(
  body: object,
): StoredImage | null | undefined {
  if (!('image' in body)) return undefined;
  const image = (body as { image?: unknown }).image;
  if (image === undefined) return undefined;
  if (image === null) return null;
  return parseImagePayload(image);
}
