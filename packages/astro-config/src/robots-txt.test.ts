import { describe, expect, it } from 'vitest';
import { ROBOTS_TXT, robotsTxt } from './robots-txt.ts';

describe('robots.txt', () => {
  it('lets crawlers read every page, but not the servers’ answers (audit 5 I-1)', () => {
    expect(ROBOTS_TXT).toBe('robots.txt');
    const lines = robotsTxt().split('\n');
    expect(lines).toEqual(['User-agent: *', 'Disallow: /api/', 'Allow: /', '']);
    // By the original rules the first matching line wins: "/api/" before "/".
    expect(lines.indexOf('Disallow: /api/')).toBeLessThan(lines.indexOf('Allow: /'));
  });
});
