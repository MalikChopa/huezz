/** Stage geometry (mock-up B): desktop 1100 x 640, vertical layout 620 x 834 under 760 px of available width. */
export const DESKTOP = { width: 1100, height: 640 } as const;
export const TALL = { width: 620, height: 834 } as const;
export const TALL_BELOW = 760;
export const MAX_SCALE = 1.2;
export const MIN_SCALE = 0.2;

export type Fit = {
  tall: boolean;
  width: number;
  height: number;
  scale: number;
  /** Height the wrapper must take (vertical layout only); null = it fills the free space. */
  wrapHeight: number | null;
};

const round = (n: number): number => Math.round(n * 10_000) / 10_000;

/** Scale of the stage for a wrapper of the given size. Pure. Never above MAX_SCALE, never below MIN_SCALE. */
export function computeFit(wrapWidth: number, wrapHeight: number): Fit {
  const tall = wrapWidth < TALL_BELOW;
  const size = tall ? TALL : DESKTOP;
  const raw = tall ? Math.min(wrapWidth / size.width, MAX_SCALE) : Math.min(wrapWidth / size.width, wrapHeight / size.height, MAX_SCALE);
  const scale = round(Math.max(MIN_SCALE, Number.isFinite(raw) ? raw : MIN_SCALE));
  return { tall, width: size.width, height: size.height, scale, wrapHeight: tall ? round(size.height * scale) : null };
}
