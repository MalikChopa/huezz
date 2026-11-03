export const MAX_BYTES = 25 * 1024 * 1024;
export const DECODE_MS = 10_000;
/** Longest side of the sample read for the colours, and width of the decoded copy kept for the preview. */
const SAMPLE_SIDE = 64;
const PREVIEW_WIDTH = 256;
const PREVIEW_HEIGHT = 1024;

export const MESSAGES = {
  tooBig: 'Cette image pèse plus de 25 Mo : choisis-en une plus légère.',
  svg: 'Les images SVG ne sont pas lues. Essaie JPEG, PNG ou WebP.',
  unsupported: 'Ce format d\'image n\'est pas lu par ton navigateur. Essaie JPEG, PNG ou WebP.',
  notImage: 'Ce fichier n\'est pas une image. Essaie JPEG, PNG ou WebP.',
  unreadable: 'Cette image n\'a pas pu être lue : le fichier est peut-être abîmé. Essaie JPEG, PNG ou WebP.',
  timeout: 'La lecture de cette image prend trop de temps : essaie une image plus légère.',
  empty: 'Aucune couleur à tirer de cette image : elle est transparente.',
  noFile: 'Dépose un fichier image (JPEG, PNG ou WebP).',
} as const;

export type Sample = { data: Uint8ClampedArray; width: number; height: number };
export type ReadResult = { ok: true; sample: Sample; preview: HTMLCanvasElement } | { ok: false; message: string };

class Refused extends Error {}

/** The first image among dropped or pasted files, else the first file (which then says it is not an image). */
export const pickFile = (files: ArrayLike<File> | null | undefined): File | null => {
  const list = Array.from(files ?? []);
  return list.find((f) => f.type.startsWith('image/')) ?? list[0] ?? null;
};

/** Rejects after `ms`; `late` receives the value if the work finishes after that (to release it). */
export function withTimeout<T>(work: Promise<T>, ms: number, late: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let over = false;
    const timer = setTimeout(() => {
      over = true;
      reject(new Refused(MESSAGES.timeout));
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        if (over) late(value);
        else resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        if (!over) reject(error);
      },
    );
  });
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release(): void };

/** Decoded by the browser, never by trust in the name or the type: a bitmap with a resize hint, else the same without it, else an <img> on an object URL (blob: is allowed by the CSP). */
async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    for (const options of [{ resizeWidth: PREVIEW_WIDTH, resizeQuality: 'medium' } as const, undefined]) {
      try {
        const bitmap = await createImageBitmap(file, options);
        return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
      } catch {
        /* the next way */
      }
    }
  }
  const img = new Image();
  const url = URL.createObjectURL(file);
  try {
    img.src = url;
    await img.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
}

async function failure(file: Blob): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const iso = String.fromCharCode(...head.slice(4, 8)) === 'ftyp';
  if (iso || /heic|heif|avif/i.test(file.type)) return MESSAGES.unsupported;
  return file.type.startsWith('image/') ? MESSAGES.unreadable : MESSAGES.notImage;
}

async function looksLikeSvg(file: Blob): Promise<boolean> {
  if (file.type === 'image/svg+xml') return true;
  return /<svg[\s>]/i.test(new TextDecoder().decode(await file.slice(0, 512).arrayBuffer()));
}

async function read(file: Blob, late: (d: Decoded) => void): Promise<ReadResult> {
  if (file.size > MAX_BYTES) return { ok: false, message: MESSAGES.tooBig };
  if (await looksLikeSvg(file)) return { ok: false, message: MESSAGES.svg };
  let decoded: Decoded;
  try {
    decoded = await withTimeout(decode(file), DECODE_MS, late);
  } catch (error) {
    return { ok: false, message: error instanceof Refused ? error.message : await failure(file) };
  }
  try {
    const k = Math.min(1, PREVIEW_WIDTH / decoded.width, PREVIEW_HEIGHT / decoded.height);
    const preview = document.createElement('canvas');
    preview.width = Math.max(1, Math.round(decoded.width * k));
    preview.height = Math.max(1, Math.round(decoded.height * k));
    preview.getContext('2d')?.drawImage(decoded.source, 0, 0, preview.width, preview.height);
    const s = Math.min(1, SAMPLE_SIDE / Math.max(preview.width, preview.height));
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(preview.width * s));
    small.height = Math.max(1, Math.round(preview.height * s));
    const ctx = small.getContext('2d', { willReadFrequently: true });
    if (ctx === null) throw new Error('canvas');
    ctx.drawImage(preview, 0, 0, small.width, small.height);
    const pixels = ctx.getImageData(0, 0, small.width, small.height);
    return { ok: true, sample: { data: pixels.data, width: pixels.width, height: pixels.height }, preview };
  } catch {
    return { ok: false, message: MESSAGES.unreadable };
  } finally {
    decoded.release();
  }
}

/** Reads a file into a small colour sample and a preview canvas. Never throws: a failure is a short French message. */
export async function readImage(file: Blob): Promise<ReadResult> {
  try {
    return await read(file, (d) => d.release());
  } catch {
    return { ok: false, message: MESSAGES.unreadable };
  }
}
