# Security

How the project protects user data, and how to check that it does.

Pages:

- [Permissions](permissions.md): every permission each app declares, and
  why.
- [Protected-paths flag](protected-paths.md): how a pull request that
  changes an owner-only path is flagged, what that protects against and
  what it does not.

What else belongs here:

- The threat model: what is protected, against whom, and what is out of
  scope. File: `threat-model.md`.
- The cryptography design. All cryptography follows it. File:
  `crypto-design.md`.
- The data inventory: what data each app stores, and where.
- The signing certificate fingerprints, so users can verify the apps. File:
  `fingerprints.md`.
- How to report a problem: see [SECURITY.md](../../SECURITY.md).

How the build checks every downloaded file is in
[ADR 0020](../adr/0020-dependency-verification.md).
