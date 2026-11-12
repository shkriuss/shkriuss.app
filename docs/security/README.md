# Security

How the project protects user data, and how to check that it does.

Pages:

- [Cryptography design](crypto-design.md): every key, where it lives and
  what it protects, the Tink primitives and their parameters, the byte
  layout of every encrypted blob, the app lock, the recovery key, key
  rotation, and test vectors. All cryptography follows it.
- [Permissions](permissions.md): every permission each app declares, and
  why, and the permissions and receivers that `core/notify` adds to an
  app with reminders.
- [Protected-paths flag](protected-paths.md): how a pull request that
  changes an owner-only path is flagged, what that protects against and
  what it does not.
- [Signing certificate fingerprints](fingerprints.md): the suite key's
  certificate, so users can verify the apps. The release workflow checks
  every release against it.

What else belongs here:

- The threat model: what is protected, against whom, and what is out of
  scope. File: `threat-model.md`.
- The data inventory: what data each app stores, and where.
- How to report a problem: see [SECURITY.md](../../SECURITY.md).

How the build checks every downloaded file is in
[ADR 0020](../adr/0020-dependency-verification.md).

The hub website shows the fingerprint, read from `fingerprints.md` at
build time. Its security headers, and what it may contain, are in
[site.md](../development/site.md#security-headers).
