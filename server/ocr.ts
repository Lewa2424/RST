import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { AppError } from './errors.js';
import { parseOcrStructured, type ParsePayload } from './parsers.js';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

function mapGeminiError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/API key|PERMISSION_DENIED|UNAUTHENTICATED|401|invalid api key/i.test(message)) {
    return new AppError(
      401,
      'OCR_UNAVAILABLE',
      'Ключ Gemini отклонён. Проверьте OCR_API_KEY и перезапустите сервер.',
    );
  }
  if (/no longer available|NOT_FOUND|404/i.test(message)) {
    return new AppError(
      503,
      'OCR_UNAVAILABLE',
      'Модель Gemini недоступна. Задайте OCR_MODEL в .env или повторите позже.',
    );
  }
  return new AppError(
    503,
    'OCR_UNAVAILABLE',
    'Распознавание фото не удалось. Повторите попытку или введите номера вручную.',
  );
}

export function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function assertUploadSize(size: number): void {
  const maxBytes = config.maxUploadMb * 1024 * 1024;
  if (size > maxBytes) {
    throw new AppError(
      413,
      'PAYLOAD_TOO_LARGE',
      `Файл больше ${config.maxUploadMb} МБ`,
    );
  }
}

export function writeTempUpload(buffer: Buffer, ext: string): string {
  fs.mkdirSync(config.importTempDir, { recursive: true });
  const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const fullPath = path.join(config.importTempDir, path.basename(name));
  fs.writeFileSync(fullPath, buffer);
  return fullPath;
}

export function safeUnlink(filePath: string): void {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // temp cleanup is best-effort
  }
}

const ocrHits: number[] = [];

function checkOcrRateLimit(): void {
  const now = Date.now();
  while (ocrHits.length && now - ocrHits[0] > 60_000) ocrHits.shift();
  if (ocrHits.length >= 20) {
    throw new AppError(429, 'OCR_UNAVAILABLE', 'Слишком много запросов OCR. Подождите минуту или введите список вручную.');
  }
  ocrHits.push(now);
}

export interface OcrProvider {
  recognize(images: Array<{ buffer: Buffer; mimeType: string }>): Promise<ParsePayload>;
}

class GeminiOcrProvider implements OcrProvider {
  async recognize(images: Array<{ buffer: Buffer; mimeType: string }>): Promise<ParsePayload> {
    if (!config.ocrApiKey) {
      throw new AppError(
        503,
        'OCR_UNAVAILABLE',
        'Распознавание фото недоступно: не задан OCR_API_KEY. Продолжите ручным вводом.',
      );
    }

    const { GoogleGenAI, Type } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: config.ocrApiKey });

    const merged: ParsePayload = { rows: [], unrecognized: [] };

    try {
      for (let imgIdx = 0; imgIdx < images.length; imgIdx++) {
      const img = images[imgIdx];
      const response = await ai.models.generateContent({
        model: config.ocrModel,
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: img.mimeType,
                  data: img.buffer.toString('base64'),
                },
              },
              {
                text: `Extract railway wagon numbers and weights from this document image (often a Polish or Russian wagon list / załącznik).
Return only values visible in the image. Do not invent missing numbers.
A wagon number may be split across table columns (country, keeper, serial, check digit). Concatenate those digits into one string.
Accept both 8-digit CIS numbers and 12-digit UIC numbers (Polish lists often look like 31 54 5949079 5).
The last digit is the check digit. weight_kg is integer kilograms from the sender mass column (masa w kg) or null.
Unrecognized fragments are leftover text that is not a wagon row.`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              rows: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    source_page: { type: Type.INTEGER },
                    source_row: { type: Type.INTEGER },
                    wagon_number_raw: { type: Type.STRING },
                    wagon_number: { type: Type.STRING },
                    weight_kg: { type: Type.INTEGER, nullable: true },
                    confidence: { type: Type.NUMBER },
                  },
                  required: ['wagon_number_raw'],
                },
              },
              unrecognized_fragments: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
          },
        },
      });

      const jsonText = response.text?.trim() || '{}';
      let parsedJson: unknown = {};
      try {
        parsedJson = JSON.parse(jsonText);
      } catch {
        parsedJson = { rows: [], unrecognized_fragments: [] };
      }
      const page = parseOcrStructured(parsedJson as Parameters<typeof parseOcrStructured>[0]);
      for (const row of page.rows) {
        merged.rows.push({ ...row, source_page: row.source_page || imgIdx + 1 });
      }
      merged.unrecognized.push(...page.unrecognized.map((u) => ({ ...u, source_page: imgIdx + 1 })));
      }

      return merged;
    } catch (err) {
      throw mapGeminiError(err);
    }
  }
}

export function getOcrProvider(): OcrProvider {
  return new GeminiOcrProvider();
}

export async function parseImages(
  files: Array<{ buffer: Buffer; originalname?: string; mimetype?: string }>,
): Promise<ParsePayload> {
  checkOcrRateLimit();
  const images: Array<{ buffer: Buffer; mimeType: string }> = [];
  const tempFiles: string[] = [];

  try {
    for (const file of files) {
      assertUploadSize(file.buffer.length);
      const mime = detectImageMime(file.buffer);
      if (!mime || !ALLOWED_MIME.has(mime)) {
        throw new AppError(
          415,
          'UNSUPPORTED_MEDIA',
          'Поддерживаются только JPEG, PNG и WEBP. HEIC сохраните как JPEG или введите номера вручную.',
        );
      }
      const ext = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
      tempFiles.push(writeTempUpload(file.buffer, ext));
      images.push({ buffer: file.buffer, mimeType: mime });
    }

    if (config.ocrProvider === 'none' || !config.ocrApiKey) {
      throw new AppError(
        503,
        'OCR_UNAVAILABLE',
        'OCR не настроен. Сделайте снимок для себя и введите номера вручную.',
      );
    }

    return await getOcrProvider().recognize(images);
  } finally {
    for (const file of tempFiles) safeUnlink(file);
  }
}
