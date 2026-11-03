import { describe, expect, it } from 'vitest';
import { removedPhotoPaths } from '../src/photos.js';

const photo = (id: string) => ({ id, w: 1600, h: 1200 });

describe('removedPhotoPaths', () => {
  it('lists both files of a photo taken off a log', () => {
    const before = { photos: [photo('a'), photo('b')] };
    const after = { photos: [photo('a')] };
    expect(removedPhotoPaths('baby1', 'log1', before, after)).toEqual([
      'babies/baby1/logs/log1/b.jpg',
      'babies/baby1/logs/log1/b_t.jpg',
    ]);
  });

  it('lists every photo of a deleted log', () => {
    expect(removedPhotoPaths('baby1', 'log1', { photos: [photo('a')] }, undefined)).toHaveLength(2);
  });

  it('lists nothing when photos are only added', () => {
    expect(removedPhotoPaths('baby1', 'log1', { photos: [] }, { photos: [photo('a')] })).toEqual([]);
    expect(removedPhotoPaths('baby1', 'log1', undefined, { photos: [photo('a')] })).toEqual([]);
  });

  it('ignores ids that could point outside the log folder', () => {
    expect(removedPhotoPaths('baby1', 'log1', { photos: [{ id: '../other' }, { id: 5 }] }, undefined)).toEqual([]);
  });
});
