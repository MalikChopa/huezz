import type { PngLayout } from '../export/png-layout';

/** Draws the layout (pure data) on a canvas: rectangles first, then texts. */
export function drawLayout(layout: PngLayout, canvas: HTMLCanvasElement): void {
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('Huezz: canvas 2D indisponible');
  for (const r of layout.rects) {
    ctx.fillStyle = r.fill;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  ctx.textBaseline = 'alphabetic';
  for (const t of layout.texts) {
    ctx.fillStyle = t.fill;
    ctx.font = t.font;
    ctx.fillText(t.text, t.x, t.y);
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob === null ? reject(new Error('Huezz: PNG non produit')) : resolve(blob)), 'image/png');
  });
}

/** Offers a blob as a download through a temporary link. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
