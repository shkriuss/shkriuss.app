/**
 * /.well-known/security.txt (RFC 9116): where to report a security problem
 * (privately, on GitHub; see SECURITY.md). Made at build time, so "Expires",
 * which must be less than a year away, moves on with every deploy.
 */
import { hubOrigin } from '@shkriuss/registry';
import type { APIRoute } from 'astro';

const REPOSITORY = 'https://github.com/shkriuss/shkriuss.app';
const VALID_DAYS = 180;

export const GET: APIRoute = () => {
  const expires = new Date(Date.now() + VALID_DAYS * 24 * 60 * 60 * 1000);
  const lines = [
    `Contact: ${REPOSITORY}/security/advisories/new`,
    `Expires: ${expires.toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
    `Policy: ${REPOSITORY}/blob/main/SECURITY.md`,
    'Preferred-Languages: en',
    `Canonical: ${hubOrigin}/.well-known/security.txt`,
  ];
  return new Response(`${lines.join('\n')}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
