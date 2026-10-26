# 0018. The account service checks that a passkey was used on the Account page

Status: Accepted (2026-10-25). Changes [ADR 0010](0010-account-and-sync.md)
(passkeys). Audit findings C-1 (second audit) and A-4. Updated in October
2026 (audit 4 A-2): what the signature on adding a lock proves, and why no
passkey is left without a lock.

## Context

- A passkey that unlocks the account belongs to the hub's domain,
  `shkriuss.app`. Browsers let any subdomain ask for a passkey of its
  parent domain, so an app's page could ask for it too and get its PRF
  value: the wrap key and the lookup token come from that value, and with
  them the lock and the account secret.
- [ADR 0010](0010-account-and-sync.md) stopped this with each app page's
  `Permissions-Policy: publickey-credentials-get=()`. Only Chromium-based
  browsers honour that header. Safari on Mac, iPhone and iPad (every iOS
  browser is Safari underneath) and Firefox ignore it: there, script running
  on any app page (an XSS, or a bad dependency) could show the passkey
  prompt, which names shkriuss.app, and take the account if the person
  approved it.
- The account service gave a lock to anyone with its lookup token, so it
  couldn't tell the Account page from any other page.

## Decision

- **A lock keeps its passkey's public key.** When a passkey is added, the
  Account page sends the lock with the passkey's public key (from the
  browser: `getPublicKey()`, ES256 or RS256) and a signature made with the
  new passkey right after making it.
- **Every use is signed.** Adding, opening and removing a lock each carry
  the passkey's signature (a WebAuthn assertion). The account service only
  acts if the signature checks out with the lock's public key, and what the
  passkey signed says:
  - it was used on the Account page: the browser writes the page's origin
    into what the passkey signs (`clientDataJSON`), so a page on a
    subdomain can't pass itself off as the Account page;
  - for this site (`rpIdHash`), with the person there and the passkey
    unlocked (the UP and UV flags);
  - for this purpose (add, open or remove), within a day of the service's
    clock. The challenge holds both, so a signature can't be used for
    anything else, or for long. (It isn't what keeps the lock safe: the
    wrap key never leaves the device.)
- The check is in `packages/account/src/webauthn.ts`, in the lock's Durable
  Object, which has the public key. The Account page's address is the
  Worker's own (`request.url`); only local browser tests, where the Worker
  sees the real site's address instead, set it (`ACCOUNT_ORIGIN`).
- **A lock can't be replaced.** Adding a lock where one exists is refused,
  and only the lock's own passkey can remove it.
- **What the signature on adding proves.** It's checked with the public key
  that comes with it, so it shows only that whoever adds the lock has that
  key pair, not that it's a real passkey used on the Account page: a script
  can make a key pair of its own and sign anything. That's enough for a
  passkey that has a lock (a second one is refused), so the Account page
  leaves no passkey without one: when its lock can't be saved, the browser
  is asked to forget it (audit 4 A-2).
- **Passkeys added before this can't be checked**: their locks have no
  public key. They no longer open; the Account page says to sign in with
  the recovery key (or a device link) and add the passkey again. They can
  still be removed.
- **The browser forgets a passkey only when the service says no lock uses
  it** (`{ unknown: true }`), not on any 404 (audit A-4). That answer isn't
  signed, so a server gone wrong could make password managers forget real
  passkeys; the recovery key still works, so nothing is lost for good
  (audit 3 A-2).
- The `Permissions-Policy` header stays, but it isn't a barrier, even in
  Chromium: an app's page can open a blank window of its own (`about:blank`,
  which has none of its headers) and ask for the passkey there, and
  `PublicKeyCredential.signalUnknownCredential()` isn't covered by it at all.
  What keeps the account safe is the service's check of each signature's
  origin, above (audit 3 C-4).

## Consequences

**Good**

- On every browser, a page other than the Account page gets nothing from
  the account service with the passkey: not the lock, not removing it, not
  putting its own lock in the place of the person's (only a passkey with
  no lock could get one, and the Account page leaves none, above).
- Nothing new is secret: the service keeps a public key with each lock.

**Bad**

- Adding a passkey asks twice (make it, then use it once), on browsers that
  used to ask once.
- People who added a passkey before need to add it again.
- A device whose clock is more than a day off can't use a passkey until the
  clock is fixed (the page says to check the date and time).

## Alternatives

- **Moving the account to its own subdomain** (`account.shkriuss.app` as
  the passkey's domain, which no app could claim). Every passkey would need
  adding again too, every signed-in device would need to sign in again
  (its storage is per address), and every link to the Account page would
  change.
- **Leaving it to `Permissions-Policy`.** Not supported in Safari or Firefox,
  and a new window gets around it in Chromium too (audit 3 C-4).
