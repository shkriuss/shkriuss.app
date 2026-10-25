import { describe, expect, it } from 'vitest';
import { fitWithin } from './photos.ts';

describe('smaller copies of photos', () => {
  it('are made smaller, never bigger', () => {
    expect(fitWithin(4032, 3024, 512)).toEqual({ width: 512, height: 384 });
    expect(fitWithin(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 320)).toEqual({ width: 240, height: 320 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(300, 200, 512)).toEqual({ width: 300, height: 200 });
  });

  it('keep at least a pixel on each side', () => {
    expect(fitWithin(10_000, 1, 320)).toEqual({ width: 320, height: 1 });
    expect(fitWithin(1, 10_000, 320)).toEqual({ width: 1, height: 320 });
  });
});
