import { defineAppConfig } from '@shkriuss/astro-config';

export default defineAppConfig({
  slug: 'hub',
  // Passkeys for the optional account (Account page).
  allowFeatures: ['publickey-credentials-create', 'publickey-credentials-get'],
});
