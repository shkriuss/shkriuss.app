/**
 * The licence files Grammar ships (public/licenses/, linked from the page)
 * name the right rights holders. GECToR's was copied from Harper's with
 * Harper's own notice, "Copyright 2024 Automattic Inc.", so it said that
 * Automattic owns Grammarly's model (audit 5 Z-3).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const licence = (name: string): string =>
  readFileSync(join(import.meta.dirname, '../public/licenses', name), 'utf8');

describe('the licence files', () => {
  it('give each work its own copyright notice, not another’s', () => {
    const harper = licence('harper.txt');
    const gector = licence('gector.txt');
    expect(harper).toContain('Copyright 2024 Automattic Inc.');
    expect(gector).not.toContain('Automattic');
    expect(gector).toContain('Grammarly');
    expect(gector).toContain('Meyssa');
    expect(gector).toContain('Copyright (c) Facebook, Inc.');
    for (const text of [harper, gector]) expect(text).toContain('END OF TERMS AND CONDITIONS');
    expect(licence('onnxruntime-web.txt')).toContain('Copyright (c) Microsoft Corporation');
  });
});
