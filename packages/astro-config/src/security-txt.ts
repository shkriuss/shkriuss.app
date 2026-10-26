/**
 * /.well-known/security.txt (RFC 9116): where to report a security problem
 * (privately, on GitHub; see SECURITY.md). Every site has its own, because
 * the RFC says a file covers only the host it's on (audit 3 I-3); the
 * integration writes it into each build.
 */
const REPOSITORY = 'https://github.com/shkriuss/shkriuss.app';

/** Where it's served, on every site. */
export const SECURITY_TXT = '.well-known/security.txt';

/**
 * The file for the site at `origin`. "Expires" must be in the future and
 * less than a year away: it's the first day of the month 7 months on, so it
 * moves on with every deploy, but builds in the same month are the same.
 */
export function securityTxt(origin: string, now = new Date()): string {
  const expires = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 7, 1));
  const lines = [
    `Contact: ${REPOSITORY}/security/advisories/new`,
    `Expires: ${expires.toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
    `Policy: ${REPOSITORY}/blob/main/SECURITY.md`,
    'Preferred-Languages: en',
    `Canonical: ${origin}/${SECURITY_TXT}`,
  ];
  return `${lines.join('\n')}\n`;
}
