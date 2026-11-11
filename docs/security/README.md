# Security

How the project protects user data, and how to check that it does.

Pages:

- [Permissions](permissions.md): every permission each app declares, and
  why.
- [Protected-paths flag](protected-paths.md): how a pull request that
  changes an owner-only path is flagged, what that protects against and
  what it does not.
- [Signing certificate fingerprints](fingerprints.md): the suite key's
  certificate, so users can verify the apps. The release workflow checks
  every release against it.

What else belongs here:

- The threat model: what is protected, against whom, and what is out of
  scope. File: `threat-model.md`.
- The cryptography design. All cryptography follows it. File:
  `crypto-design.md`.
- The data inventory: what data each app stores, and where.
- How to report a problem: see [SECURITY.md](../../SECURITY.md).

How the build checks every downloaded file is in
[ADR 0020](../adr/0020-dependency-verification.md).

The hub website shows the fingerprint, read from `fingerprints.md` at
build time. Its security headers, and what it may contain, are in
[site.md](../development/site.md#security-headers).
