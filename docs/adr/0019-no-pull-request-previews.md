# 0019. No pull request previews

Status: Accepted (2026-10-25). Changes [ADR 0002](0002-cloudflare-workers-static-assets.md)
(it gave pull requests Worker Previews), and the parts of
[ADR 0009](0009-push-notifications.md), [ADR 0010](0010-account-and-sync.md),
[ADR 0012](0012-deep-check-ai-model.md), [ADR 0016](0016-online-photo-library.md)
and [ADR 0017](0017-storage-limits.md) that made room for previews.

## Context

- Once the owner approved it, a pull request got a preview of every site, at
  `pr-<number>-<site>.shkriuss.workers.dev` (ADR 0002).
- A preview ran the pull request's own code, before anyone had merged it,
  with the Cloudflare token, which can also change the live sites. Only the
  owner's approval stood between unmerged code and that token. (The first
  audit's H-1 was the preview job giving the token, and the real storage
  code, to unmerged code before that approval existed.)
- Previews were public: their links were posted on the pull request, and the
  repository is public. Their servers weren't behind the rate limit at
  Cloudflare, so a stranger could use them to use up the free daily requests
  that every app shares (ADR 0017). And someone could type their real
  recovery key into code nobody had merged; every page of a preview said it
  was one (the second audit's D-2).
- Each set of previews needed its own server storage, as much as the live
  sites. With the free plan's 100 Durable Object namespaces, only two pull
  requests could have previews at once, and one more app with sync would
  have left room for one. Part of every storage limit was kept for them too.
- In practice the owner merges when CI is green, without looking at
  previews.

## Decision

- **No previews.** The preview workflow and script are gone, and so is
  everything only previews used: the note at the top of every preview page,
  their own smaller storage limits in every server, the preview addresses in
  sync's pairing of apps with the hub, and the `shkriuss-photos-preview`
  bucket.
- **Each site is only at its own domain.** Every `wrangler.jsonc` sets
  `"preview_urls": false` as well as `"workers_dev": false`. That also closes
  the addresses where Cloudflare kept old builds of five sites public (the
  first audit's I-6).
- **The token is only in the `production` environment,** which only runs on
  `main`. There's no `preview` environment.
- A pull request gets CI's checks. Once it's merged, the change is live, and
  the owner looks at it there; if it's wrong, revert it
  ([deployment](../deployment.md#rolling-back)).

## Consequences

- No unmerged code ever runs with the token, and there are no public copies
  of unmerged code, and no server outside the rate limit.
- All 100 Durable Object namespaces and the 4.5 GB storage budget are for the
  live sites (33 namespaces and 3.1 GB of limits today).
- Fewer parts to keep working: a workflow, a script, a GitHub environment, a
  storage bucket, and an approval on every push.
- Nobody can try a change on a phone before it's live. Tests run in Chromium
  only, so a problem only Safari or an iPhone shows reaches the live site
  first; reverting takes about 20 minutes. A change to how an app saves its
  data can't be tried first either, and can't be rolled back past
  ([deployment](../deployment.md#rolling-back)), so it needs the most careful
  tests.

## Alternatives

- **Keep previews, and approve them only when needed:** keeps a copy of the
  token where unmerged code can reach it, and public servers outside the rate
  limit, for something that wasn't used.
- **Previews behind a sign-in (Cloudflare Access):** makes them private, but
  unmerged code still runs with the token, and it's more setup.
- **Previews of the pages only, without the servers:** no sync,
  notifications or online library to try, and they still need the token.
