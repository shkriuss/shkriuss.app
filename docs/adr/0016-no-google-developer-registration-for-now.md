# 0016 No developer registration with Google for now

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) section 2 (decision 1), and the owner's
  review of [pull request 4](https://github.com/shkriuss/shkriuss.app/pull/4)

## Context

- GrapheneOS is the first target. Other Android systems come second. See
  [0002](0002-grapheneos-first-minimum-android-13.md).
- Google began enforcing developer verification on certified Android
  devices on 30 September 2026, in Brazil, Indonesia, Singapore and
  Thailand. A global rollout is planned for 2027.
- Where it applies, apps from unregistered developers install or update
  only in two ways:
  - a one-time "advanced flow": developer options, a restart and a one-day
    wait,
  - or adb.
- Google's FAQ:
  <https://developer.android.com/developer-verification/guides/faq>

## Decision

1. The project does not register as a developer with Google for now.
2. Stock Android users install the apps through the advanced flow.
3. This decision is revisited before the 2027 global rollout.

## Options rejected

- **Register with Google now.**
  - It costs 25 US dollars once for full distribution, or is free for up to
    20 devices.
  - It may need a government ID under the owner's legal name.
  - It is not needed on GrapheneOS, which is not a certified device.
  - Stock Android users have the advanced flow.

## Consequences

- The install guide in `docs/user/` explains the advanced flow for stock
  Android users.
- A review of this record is due before the 2027 global rollout.
