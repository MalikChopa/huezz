import { describe, expect, it } from 'vitest';
import { computeFit, DESKTOP, MAX_SCALE, MIN_SCALE, TALL, TALL_BELOW } from '../../src/ui/fit';

describe('computeFit (desktop layout)', () => {
  it('uses 1100 x 640 and the smaller of the width ratio and the height ratio', () => {
    const f = computeFit(1100, 640);
    expect(f).toEqual({ tall: false, width: DESKTOP.width, height: DESKTOP.height, scale: 1, wrapHeight: null });
    expect(computeFit(1100, 320).scale).toBe(0.5);
    expect(computeFit(770, 640).scale).toBe(0.7);
    expect(computeFit(1360, 562).scale).toBeCloseTo(562 / 640, 4);
  });

  it('never goes above x1.2, however large the wrapper is', () => {
    expect(computeFit(1360, 900).scale).toBe(MAX_SCALE);
    expect(computeFit(5000, 5000).scale).toBe(1.2);
    expect(computeFit(1320, 768).scale).toBe(1.2);
    expect(computeFit(1319, 768).scale).toBeLessThan(1.2);
  });

  it('never goes below the minimum, even for a tiny or empty wrapper', () => {
    expect(computeFit(760, 10).scale).toBe(MIN_SCALE);
    expect(computeFit(760, 0).scale).toBe(MIN_SCALE);
    expect(computeFit(0, 0).scale).toBe(MIN_SCALE);
    expect(computeFit(Number.NaN, 500).scale).toBe(MIN_SCALE);
  });

  it('is monotonic in the width and in the height', () => {
    let last = 0;
    for (let w = 760; w <= 1500; w += 20) {
      const s = computeFit(w, 600).scale;
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
    last = 0;
    for (let h = 100; h <= 900; h += 20) {
      const s = computeFit(1300, h).scale;
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });
});

describe('computeFit (vertical layout under 760 px)', () => {
  it('switches at 760 px of wrapper width', () => {
    expect(computeFit(TALL_BELOW, 500).tall).toBe(false);
    expect(computeFit(TALL_BELOW - 1, 500).tall).toBe(true);
  });

  it('fits 620 x 834 to the width, ignores the height, and gives the wrapper its scaled height', () => {
    const f = computeFit(358, 12345);
    expect(f.tall).toBe(true);
    expect(f.width).toBe(TALL.width);
    expect(f.height).toBe(TALL.height);
    expect(f.scale).toBeCloseTo(358 / 620, 4);
    expect(f.wrapHeight).toBeCloseTo(834 * (358 / 620), 1);
    expect(computeFit(358, 5).scale).toBe(computeFit(358, 5000).scale);
  });

  it('is also capped at x1.2, and never below the minimum', () => {
    expect(computeFit(759, 400).scale).toBe(MAX_SCALE);
    expect(computeFit(700, 400).scale).toBeCloseTo(700 / 620, 4);
    expect(computeFit(50, 400).scale).toBe(MIN_SCALE);
    expect(computeFit(50, 400).wrapHeight).toBeCloseTo(834 * MIN_SCALE, 1);
  });
});
