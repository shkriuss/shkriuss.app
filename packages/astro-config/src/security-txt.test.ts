import { describe, expect, it } from 'vitest';
import { SECURITY_TXT, securityTxt } from './security-txt.ts';

const DAY = 24 * 60 * 60 * 1000;

describe('security.txt', () => {
  it('says where to report a problem, for the host it is on (audit 3 I-3)', () => {
    const text = securityTxt('https://tally.shkriuss.app', new Date(Date.UTC(2026, 9, 26)));
    expect(text).toContain(
      'Contact: https://github.com/shkriuss/shkriuss.app/security/advisories/new',
    );
    expect(text).toContain(
      'Policy: https://github.com/shkriuss/shkriuss.app/blob/main/SECURITY.md',
    );
    expect(text).toContain(`Canonical: https://tally.shkriuss.app/${SECURITY_TXT}`);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('expires in the future and less than a year away, whatever the day (RFC 9116)', () => {
    for (let month = 0; month < 24; month += 1) {
      for (const day of [1, 15, 28, 31]) {
        const now = new Date(Date.UTC(2026, month, day, 23, 59));
        const expires = Date.parse(
          /^Expires: (.+)$/m.exec(securityTxt('https://x', now))?.[1] ?? '',
        );
        expect(expires - now.getTime()).toBeGreaterThan(150 * DAY);
        expect(expires - now.getTime()).toBeLessThan(365 * DAY);
      }
    }
  });

  it('is the same for builds in the same month', () => {
    const early = securityTxt('https://x', new Date(Date.UTC(2026, 9, 1)));
    const late = securityTxt('https://x', new Date(Date.UTC(2026, 9, 31, 23)));
    expect(late).toBe(early);
  });
});
