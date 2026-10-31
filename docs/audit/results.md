# Audit results, October 2026

This is what each full audit found, and what happened to each finding.
The brief every auditor followed is in [README.md](README.md), and the
prompts for each AI tool are in [prompts.md](prompts.md).

The repository is public, so anything still open that could be used against
anyone is listed here without its details until it's fixed (see
[SECURITY.md](../../SECURITY.md)).

## Five audits, five sets of numbers

Each audit numbered its findings by area from 1, so "B-2" means a different
finding in each. Here, the second audit's numbers start with 2 ("2B-2"), the
third's with 3 ("3B-2"), the fourth's with 4 ("4B-2") and the fifth's with 5
("5B-2"). Code comments, commits and docs name the finding they fix like
this:

| Audit                                | Fixed in                                                                                                                              | Written there as                      | Here |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---- |
| [First](#first-audit), 162 findings  | [#50](https://github.com/shkriuss/shkriuss.app/pull/50) to [#62](https://github.com/shkriuss/shkriuss.app/pull/62), 23 and 24 October | "(audit B-2)", in a change before #70 | B-2  |
| [Second](#second-audit), 79 findings | [#70](https://github.com/shkriuss/shkriuss.app/pull/70) to [#77](https://github.com/shkriuss/shkriuss.app/pull/77), 25 October        | "(audit B-2)", in #70 to #77          | 2B-2 |
| [Third](#third-audit), 77 findings   | [#79](https://github.com/shkriuss/shkriuss.app/pull/79) to [#88](https://github.com/shkriuss/shkriuss.app/pull/88), 26 October        | "(audit 3 B-2)"                       | 3B-2 |
| [Fourth](#fourth-audit), 78 findings | [#89](https://github.com/shkriuss/shkriuss.app/pull/89) to [#93](https://github.com/shkriuss/shkriuss.app/pull/93), 26 and 27 October | "(audit 4 B-2)"                       | 4B-2 |
| [Fifth](#fifth-audit), 81 findings   | [#94](https://github.com/shkriuss/shkriuss.app/pull/94) to [#99](https://github.com/shkriuss/shkriuss.app/pull/99), 27 October        | "(audit 5 B-2)"                       | 5B-2 |

So an "(audit B-2)" without an audit number means the first or the second
audit: the history of its line (`git blame`, or **Blame** on GitHub) shows
which pull request wrote it. The next audit writes its own number the same
way: "(audit 6 B-2)" in code, "6B-2" here (the brief says so too).

## First audit

### How it was done

- **Who:** Claude Code checked every area in the brief, one at a time, with a
  separate review for each area. Other AI tools can repeat the audit with the
  same prompts, and their reports are compared against this list.
- **What:** the code in this repository, the GitHub settings and workflows,
  and the live sites: the domain, its DNS records, its certificates, the
  security headers and the Cloudflare settings that can be seen from outside.
- **Evidence:** each finding came with the code that shows it, or a test or
  command that proves it. Each fix comes with a test that fails without it,
  where one can be written.
- **Fixes:** in pull requests
  [#50](https://github.com/shkriuss/shkriuss.app/pull/50),
  [#52](https://github.com/shkriuss/shkriuss.app/pull/52),
  [#53](https://github.com/shkriuss/shkriuss.app/pull/53),
  [#54](https://github.com/shkriuss/shkriuss.app/pull/54),
  [#56](https://github.com/shkriuss/shkriuss.app/pull/56),
  [#57](https://github.com/shkriuss/shkriuss.app/pull/57),
  [#60](https://github.com/shkriuss/shkriuss.app/pull/60) and
  [#61](https://github.com/shkriuss/shkriuss.app/pull/61).

### Totals

| Severity | Found | Fixed | Partly fixed | Your setting | Your choice | Later | Explained or accepted |
| -------- | ----- | ----- | ------------ | ------------ | ----------- | ----- | --------------------- |
| High     | 14    | 14    | –            | –            | –           | –     | –                     |
| Medium   | 34    | 34    | –            | –            | –           | –     | –                     |
| Low      | 90    | 88    | –            | –            | 1           | –     | 1                     |
| Info     | 24    | 18    | –            | –            | 1           | –     | 5                     |
| **All**  | 162   | 154   | –            | –            | 2           | –     | 6                     |

"Your setting" means a change in Cloudflare or GitHub that only the owner can
make, listed in [deployment.md](../deployment.md). "Later" means a real but
small problem, or a bigger change, that's planned rather than done now.

### What the owner decided

Nothing was left for the owner then. The third audit found two settings not
quite finished (3I-1 and 3I-2, in [What's left for you](#whats-left-for-you)).

**Settings:** all done (23 October 2026), step by step in
[deployment.md](../deployment.md). The ones that can be seen from outside
were checked: the email and certificate records, the limit on requests to
the servers, the deploy's token and storage code, previews waiting for
approval (pull request previews were removed later:
[ADR 0019](../adr/0019-no-pull-request-previews.md)), and pages that nothing
rewrites.

**Choices:** decided on 24 October 2026, keeping the defaults:

- **F1-10:** a task due today at a set time becomes "Overdue" only the next
  day, not as soon as its time passes.
- **I-6:** old builds stay at their "version preview" addresses, which are
  hard to guess and show only code that was public anyway. Hiding them would
  also put pull request previews behind a sign-in. (Since 25 October 2026
  there are no pull request previews, and these addresses are turned off:
  [ADR 0019](../adr/0019-no-pull-request-previews.md).)
- **Z-11:** the repository has no licence file, so anyone may read the code
  but not reuse it.

### Every finding

Severity is the auditor’s: **High** could lose or leak data or cost money; **Medium** breaks something people rely on; **Low** is a smaller bug; **Info** is a note.

#### A. Account and keys

| ID  | Severity | What was wrong                                                                                                                                        | What happened                                                                            |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A-1 | High     | The lost device can start the moved copy again, so "Replace the account key" doesn't shut it out                                                      | Fixed                                                                                    |
| A-2 | Medium   | The storage code's "10 wrong tries an hour" is per library, and anyone can make new libraries                                                         | Fixed (then changed again by Z-1)                                                        |
| A-3 | Medium   | After the key is replaced, the old key can take over the online photo library before the person's device moves it                                     | Fixed                                                                                    |
| A-4 | Low      | The 40-bit account code can be matched by brute force, so it doesn't catch a targeted fake link                                                       | Explained (ADR 0010): the code spots mistakes, the QR code and link carry the real check |
| A-5 | Low      | A device-link QR code used by someone else looks like a normal success, so it isn't noticed                                                           | Fixed                                                                                    |
| A-6 | Low      | After "Replace the account key", the old key keeps full access to each app until that app is turned on again, but the page says it "stops it syncing" | Fixed                                                                                    |
| A-7 | Info     | Bearer tokens can be replayed by anyone who sees Worker requests; the status token alone can lock an account out for good                             | Accepted: only Cloudflare, which runs the servers, sees requests                         |
| A-8 | Info     | The ADRs don't say what the servers can roll back, withhold or drop                                                                                   | Fixed: written down (ADRs 0010, 0016); old copies and false notes delete nothing         |

#### B. Servers and the bill

| ID   | Severity | What was wrong                                                                                                    | What happened                                                                                 |
| ---- | -------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| B-1  | High     | Anyone can fill the 5 GB of Durable Object storage that every app shares, for good                                | Fixed (a limit on what each app’s servers keep, and copies nobody uses are deleted: ADR 0017) |
| B-2  | High     | One push upload from a stranger wakes the server about 2,500 times a day, forever                                 | Fixed                                                                                         |
| B-3  | High     | An unlocked library stays unlocked for good, and there's no limit across libraries                                | Fixed                                                                                         |
| B-4  | Medium   | The storage code's "10 wrong tries an hour" doesn't limit guessing                                                | Fixed                                                                                         |
| B-5  | Medium   | "Remove" writes 201 rows per request, with no code and no limit, enough to stop every write on the account        | Fixed                                                                                         |
| B-6  | Medium   | Strangers can make R2 bill for operations without the storage code                                                | Fixed                                                                                         |
| B-7  | Low      | Sealed files can stay in R2 outside the library's list: after a failed commit, and after "Delete the online copy" | Fixed (a weekly clean-up of files not in the list; an upload never joins a newer library)     |
| B-8  | Low      | The daily upload limit is per library, and a full day's uploads use most of the free daily writes                 | Fixed                                                                                         |
| B-9  | Low      | Syncing a copy near the documented size likely goes over the free plan's 10 ms CPU limit                          | Fixed (a full upload took the Worker 11 to 36 ms on Cloudflare; now at most about 6 ms)       |
| B-10 | Low      | A notification schedule that passes every check is too big to store                                               | Fixed                                                                                         |
| B-11 | Low      | Body size limits are checked only after the whole body has been read                                              | Fixed                                                                                         |
| B-12 | Low      | The push address checks can be bypassed with a redirect                                                           | Fixed                                                                                         |
| B-13 | Low      | The time-zone cache grows with every spelling of a time zone                                                      | Fixed                                                                                         |
| B-14 | Low      | Deleting a library never finishes if its alarm keeps failing                                                      | Fixed                                                                                         |
| B-15 | Low      | PushDevice handles requests without `blockConcurrencyWhile`, unlike the other objects                             | Fixed                                                                                         |
| B-16 | Info     | Until the person's device moves the library, a lost device can move it to a token of its own                      | Fixed (with A-3)                                                                              |

#### C. Pages and the browser

| ID  | Severity | What was wrong                                                                                          | What happened |
| --- | -------- | ------------------------------------------------------------------------------------------------------- | ------------- |
| C-1 | Medium   | The account passkey belongs to the apex domain, so every subdomain can use it                           | Fixed         |
| C-2 | Low      | Calendar import: slow regular expression on `TZID` freezes the page                                     | Fixed         |
| C-3 | Low      | Calendar export writes event ids unescaped, so saved data can add lines and events to the `.ics` file   | Fixed         |
| C-4 | Low      | Shelf shows links from restored backups and synced data without checking the scheme                     | Fixed         |
| C-5 | Low      | The service worker shows an error response instead of the saved copy                                    | Fixed         |
| C-6 | Low      | The service worker saves every page URL it navigates to, including query strings and big non-page files | Fixed         |
| C-7 | Low      | The notification click check lets `/\host` through, which opens another website                         | Fixed         |
| C-8 | Low      | "Save original" keeps invisible direction marks in file names                                           | Fixed         |

#### D. Privacy and what the pages promise

| ID   | Severity | What was wrong                                                                                                                 | What happened |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| D-1  | Medium   | Calendar sends imported events' calendar-file IDs to its notification server unencrypted                                       | Fixed         |
| D-2  | Medium   | "Turn off" and "Delete all data" say reminders were removed from the server even when that failed                              | Fixed         |
| D-3  | Medium   | After "Replace the account key", the lost device's apps keep syncing, and its old keys and passkeys still work                 | Fixed         |
| D-4  | Medium   | "Sign out" leaves every app on that device syncing, and makes it harder to turn them off                                       | Fixed         |
| D-5  | Medium   | Calendar events imported with a long UID (Outlook) stop every closed reminder (outside area D, found while checking D-1)       | Fixed         |
| D-6  | Low      | "Delete all data" in Grammar leaves the 380 MB Deep check model                                                                | Fixed         |
| D-7  | Low      | The privacy page doesn't say what Cloudflare sees per request, and it overstates that accounts can't be linked                 | Fixed         |
| D-8  | Low      | The privacy page doesn't say what the push service learns                                                                      | Fixed         |
| D-9  | Low      | "Delete the online copy" leaves records on the server, and Photos' deletion relies on the alarm retrying                       | Fixed         |
| D-10 | Low      | "Delete the online copy" while a move to a new account key is still pending leaves the old copies (and Photos' library) online | Fixed         |
| D-11 | Low      | "Blocking notifications deletes everything for that device" only happens later                                                 | Fixed         |
| D-12 | Low      | The hosting section promises more than the owner controls                                                                      | Fixed         |
| D-13 | Low      | Short texts say data stays on the device with no "unless"                                                                      | Fixed         |
| D-14 | Low      | The privacy table and the hub's row leave out what's kept online                                                               | Fixed         |
| D-15 | Low      | Calendar's README says nothing is sent and there's no push server                                                              | Fixed         |
| D-16 | Low      | Repairs' README says "Delete all data" deletes photos online                                                                   | Fixed         |
| D-17 | Low      | SECURITY.md is out of date or wrong in three places                                                                            | Fixed         |
| D-18 | Info     | Nothing on a server is ever deleted for a device or account that stops being used                                              | Fixed         |

#### E. Saving and syncing data

| ID   | Severity | What was wrong                                                                                                                                                                                   | What happened                           |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| E-1  | High     | Rolling back an app after a data version change wipes people's data, and with sync on it deletes it on every device                                                                              | Fixed                                   |
| E-2  | High     | A sync that is already running undoes "Delete all data" and "Turn off"; after "Delete all data" the reload deletes everything on every device                                                    | Fixed                                   |
| E-3  | High     | Changes from other devices are saved, but the page isn't told until the upload succeeds; an edit in between brings back deleted items and deletes new ones everywhere                            | Fixed                                   |
| E-4  | High     | The first sync after a data version change marks every item as just edited, so the stalest device overwrites everyone else's edits and brings back deletions                                     | Fixed                                   |
| E-5  | High     | Photos: after the account key is replaced, a device that only has the new key can replace the record of the real online library, cutting everyone off from it while the lost device keeps access | Fixed (one rare case left, in ADR 0016) |
| E-6  | Medium   | A device whose clock is behind silently loses its own edits and deletions, with no conflict at all                                                                                               | Fixed                                   |
| E-7  | Medium   | Deleted items come back after 180 days: from a device that hasn't synced in that time, after sync was off that long, or because of a clock far ahead                                             | Fixed                                   |
| E-8  | Medium   | "Keep both" stops protecting an edit after an upload fails, or after an edit made while sync was off                                                                                             | Fixed                                   |
| E-9  | Medium   | Safari's 7-day deletion and private windows: nobody is told, and only apps with photos ask the browser to keep their data                                                                        | Fixed                                   |
| E-10 | Medium   | Photos' "Free up space" trusts this device's old note that photos are online                                                                                                                     | Fixed                                   |
| E-11 | Low      | A calendar file with `UID:__proto__` stops sync on that device for good                                                                                                                          | Fixed                                   |
| E-12 | Low      | The list's order is one value for the whole list, so adding or deleting an item on one device undoes a reorder made on another                                                                   | Fixed: only a move changes the order    |

#### F1. Calendar, Tasks, Reminders, Habits, Water

| ID    | Severity | What was wrong                                                                                               | What happened                                        |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| F1-1  | Medium   | Monthly and yearly tasks drift to the 28th for good after one short month                                    | Fixed                                                |
| F1-2  | Medium   | In fluid ounces, drinking exactly the goal in bottles doesn't reach it ("0 fl oz to go")                     | Fixed                                                |
| F1-3  | Low      | Calendar won't save or import a daily event that goes past midnight                                          | Fixed                                                |
| F1-4  | Low      | Importing a repeating event can drop its last time when the two time zones change clocks on different dates  | Fixed                                                |
| F1-5  | Low      | Repeating events imported from another time zone are an hour off for part of the year, without a word        | Fixed: the import says when times may be an hour off |
| F1-6  | Low      | In a daylight-saving gap, reminders west of UTC go off an hour early, the evening before at midnight changes | Fixed                                                |
| F1-7  | Low      | After travelling, notifications keep the old time zone until the app is reloaded or something changes        | Fixed                                                |
| F1-8  | Low      | Ticking off a repeating task dated in the year 9999 empties the whole task list                              | Fixed                                                |
| F1-9  | Low      | Calendar's README says nothing is ever sent and there's no push server                                       | Fixed (as D-15)                                      |
| F1-10 | Info     | A task due today at a time isn't "Overdue" once that time has passed                                         | Kept as is (your choice): overdue from the next day  |

#### F2. Budget, Trades, Repairs, Meals, Tally

| ID    | Severity | What was wrong                                                                                            | What happened                                            |
| ----- | -------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| F2-1  | High     | An amount that rounds to 0 makes Budget lose every entry (or every category), on every synced device      | Fixed                                                    |
| F2-2  | Medium   | A comma typed in a money or hours field is dropped or misread without a word ("12,50" is saved as 1250)   | Fixed                                                    |
| F2-3  | Low      | Meals' shopping ticks and hand-added items don't show on a synced device whose week starts on another day | Fixed: lists are kept under the week's Monday            |
| F2-4  | Low      | Trades' setups are case- and space-sensitive, so one setup splits into several in "By setup"              | Fixed                                                    |
| F2-5  | Low      | Trades accepts any size of number, so results can show Infinity or NaN, and very small prices show as 0   | Fixed                                                    |
| F2-6  | Low      | Trades rounds the win rate to whole percent: 1 loss in 250 shows "100%"                                   | Fixed                                                    |
| F2-7  | Low      | A Repairs day cut by "Show more" shows a day total for only part of the day                               | Fixed                                                    |
| F2-8  | Low      | The item limits are reachable in normal use, and there's no way to clear old items except one at a time   | Fixed: measured limits, Delete a year, plans kept a year |
| F2-9  | Info     | Tally keeps two counters, not the sum, when both devices counted                                          | By design (both devices counted)                         |
| F2-10 | Info     | Refunds in a category and partial closes can't be recorded                                                | Fixed: refunds in Budget, partial closes in Trades       |
| F2-11 | Info     | Tests: gaps that let F2-1 to F2-3 through                                                                 | Fixed (tests added with each fix)                        |

#### F3. Notes, Shelf, Grammar, Photos

| ID    | Severity | What was wrong                                                                                                                                                   | What happened |
| ----- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| F3-1  | High     | Notes: an edit from another device is lost when a sync finishes while you're typing                                                                              | Fixed         |
| F3-2  | High     | Photos: after this device connects to a different account, photos stay marked as online in the old library, and "Free up space" offers to remove their originals | Fixed         |
| F3-3  | Medium   | Grammar: switching between American and British English forgets your dictionary until the page is reloaded                                                       | Fixed         |
| F3-4  | Low      | Notes: a version 1 note whose first line is long loses most of that line on its first edit                                                                       | Fixed         |
| F3-5  | Low      | Shelf: saving a form that was open while a sync arrived silently undoes the other device's changes to that item                                                  | Fixed         |
| F3-6  | Low      | Shelf: "Price, low to high" compares numbers across currencies                                                                                                   | Fixed         |
| F3-7  | Low      | Grammar: Harper's old suggestions can come back after the text is cleared                                                                                        | Fixed         |
| F3-8  | Low      | Grammar Deep check: removing the first word after "(" or an opening quote leaves a stray space                                                                   | Fixed         |
| F3-9  | Low      | Privacy page: two sentences aren't true any more                                                                                                                 | Fixed         |
| F3-10 | Low      | Shelf: a link with a port, typed without "https://", is refused                                                                                                  | Fixed         |
| F3-11 | Info     | Photos: adding a photo again after "Free up space" says it's "already here", and can't put the original back                                                     | Fixed         |

#### G. Accessibility

| ID   | Severity | What was wrong                                                                                        | What happened                                                              |
| ---- | -------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| G-1  | Medium   | When saving fails, most people aren’t told, and some apps go on as if it was saved                    | Fixed                                                                      |
| G-2  | Medium   | "Delete all data" deletes nothing while the network hangs, and only says "Deleting…"                  | Fixed                                                                      |
| G-3  | Medium   | An error shown after pressing Enter or "Done" in the field isn’t read out                             | Fixed                                                                      |
| G-4  | Medium   | Two one-tap buttons destroy data with no confirmation and no undo                                     | Fixed                                                                      |
| G-5  | Low      | Habits’ "last 7 days" shows a tick on every day, done or not                                          | Fixed                                                                      |
| G-6  | Low      | In Windows contrast themes, selected and "on" states disappear                                        | Fixed                                                                      |
| G-7  | Low      | Buttons that are waiting get disabled, which throws keyboard and screen reader focus back to the page | Fixed                                                                      |
| G-8  | Low      | While the network hangs, sync shows "Syncing…" for ever, and "Turn on sync" goes silent               | Fixed                                                                      |
| G-9  | Low      | With sync on, the sync status is read out again every minute                                          | Fixed                                                                      |
| G-10 | Low      | The Restore dialog opens with "Restore" focused, the button that replaces everything                  | Fixed                                                                      |
| G-11 | Low      | With text at 200%, the theme switch doesn’t wrap, so every page scrolls sideways                      | Fixed                                                                      |
| G-12 | Low      | Some tap targets are smaller than the project’s own 44 px rule                                        | Fixed (the footer links); Calendar's days at 320px are a written exception |
| G-13 | Low      | text-size-adjust: none may turn off Android’s own text-size setting                                   | Fixed: changed to the safer 100% (not tried on an Android phone)           |
| G-14 | Info     | Smaller points: Grammar’s fixes clear undo, double announcements, three wordings for "Couldn’t save"  | Fixed                                                                      |

#### H. CI and deploys

| ID   | Severity | What was wrong                                                                                                                           | What happened                                                               |
| ---- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| H-1  | High     | Preview job gives the production Cloudflare token and the real storage code to unmerged, unchecked PR code                               | Fixed                                                                       |
| H-2  | Medium   | Dependabot PRs get the production token as soon as a person pushes to, updates or reopens them                                           | Fixed                                                                       |
| H-3  | Medium   | The 7-day `minimumReleaseAge` doesn't apply to versions already in `pnpm-lock.yaml`, so CI installs brand-new versions a PR writes there | Fixed                                                                       |
| H-4  | Low      | The production deploy job shows the Cloudflare token to every step, not just the two that need it                                        | Fixed                                                                       |
| H-5  | Low      | The pin test and CI's offline zizmor accept any 40-character SHA, including commits that aren't in the action's repository               | Fixed                                                                       |
| H-6  | Low      | Production deploy doesn't wait for the Dependency audit                                                                                  | Fixed                                                                       |
| H-7  | Low      | The "New app" job keeps a write-capable token on disk while it installs, builds and tests                                                | Fixed                                                                       |
| H-8  | Low      | Following the docs to redeploy can quietly do nothing, or put older code back live                                                       | Fixed                                                                       |
| H-9  | Low      | The deploy job reuses a dependency cache that jobs running test-only code can write                                                      | Fixed                                                                       |
| H-10 | Low      | `sharp` is allowed to run install scripts, but needs none                                                                                | Fixed                                                                       |
| H-11 | Info     | The PR being checked defines its own required checks                                                                                     | Fixed (your setting: required checks come from the rules on main)           |
| H-12 | Info     | Production doesn't run exactly the files that were tested                                                                                | Accepted: the deploy uses the tested build, plus checksum-checked downloads |
| H-13 | Info     | Some CI tools are pinned by hand and Dependabot never updates them                                                                       | Fixed: Dependabot updates zizmor; quality.md lists gitleaks and pnpm        |

#### I. Domain and Cloudflare

| ID   | Severity | What was wrong                                                                                                        | What happened                                                                                  |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| I-1  | High     | Auto-renew is off, so the domain won't renew itself                                                                   | Fixed (your setting)                                                                           |
| I-2  | Low      | No SPF, DMARC or null MX records say the domain sends no email, and two email forwarding rules sit unused             | Fixed (your setting; checked on 23 October), apart from the two forwarding rules: see 3I-1     |
| I-3  | Low      | Cloudflare features can rewrite live pages, and nothing checks the live HTML                                          | Fixed (the features are off, and the live check spots a changed page); two leftovers: see 3I-2 |
| I-4  | Low      | The privacy page says Cloudflare data "is not collected", but Cloudflare keeps security events and traffic statistics | Fixed                                                                                          |
| I-5  | Low      | No CAA record, so any public CA may issue certificates for the domain                                                 | Fixed (your setting; checked on 23 October)                                                    |
| I-6  | Low      | 36 old builds stay public indefinitely at "version preview" addresses                                                 | Kept at first (your choice); turned off later (ADR 0019)                                       |
| I-7  | Low      | No `security.txt` on any site                                                                                         | Fixed                                                                                          |
| I-8  | Info     | Nothing at the edge limits requests to `/api/*`, and all apps share the free daily limits                             | Fixed (your setting; checked on 23 October)                                                    |
| I-9  | Info     | GitHub repository settings to tidy                                                                                    | Fixed (your setting)                                                                           |
| I-10 | Info     | Small Cloudflare account settings to add                                                                              | Fixed (your setting)                                                                           |
| I-11 | Info     | Previews get the production storage code                                                                              | Fixed                                                                                          |

#### J. Architecture and tests

| ID   | Severity | What was wrong                                                                                                               | What happened                                                         |
| ---- | -------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| J-1  | Medium   | Long lists are rebuilt in full on every change, which freezes Tasks (and likely Shelf and Notes) well below their own limits | Fixed                                                                 |
| J-2  | Medium   | Every colour depends on CSS `light-dark()` with no fallback, and no browser baseline is written down or tested               | Fixed                                                                 |
| J-3  | Medium   | Photos reloads, checks and re-sorts the whole library every time the window gets focus                                       | Fixed                                                                 |
| J-4  | Medium   | The JS size budget doesn't count shared chunks, so two pages are over budget while `check:dist` passes                       | Fixed                                                                 |
| J-5  | Medium   | Browser tests don't check the second device for errors, CSP violations or outside requests                                   | Fixed                                                                 |
| J-6  | Low      | The "notifications while open" code is copied into six apps, and five of them never test the iPhone and blocked cases        | Fixed: @shkriuss/ui/local-reminders, one shared test                  |
| J-7  | Low      | Three files of about 1,000 lines, each mostly one closure, are hard to change safely                                         | Fixed: parts moved to files of their own                              |
| J-8  | Low      | Small helpers are copied between apps and have drifted, including a slow comparator and a misleading "Couldn't save"         | Fixed: shared helpers in @shkriuss/ui                                 |
| J-9  | Low      | Several docs no longer describe the system                                                                                   | Fixed                                                                 |
| J-10 | Low      | The app template's test bypasses the shared browser checks                                                                   | Fixed                                                                 |
| J-11 | Low      | Scheduled notification delivery (the push Durable Object's alarm) has no test                                                | Fixed                                                                 |
| J-12 | Low      | The files database can't be upgraded safely, and a database without its table is never repaired                              | Fixed                                                                 |
| J-13 | Low      | Local browser tests use fixed ports and reuse whatever server is already listening                                           | Fixed                                                                 |
| J-14 | Info     | Browser tests always start all 15 servers, and CI time grows about a minute per app toward a 30-minute limit                 | Fixed: E2E_SITES starts only the sites asked for                      |
| J-15 | Info     | Storage that's synchronous and `localStorage`-only will be hard to grow, and app limits already exceed what fits             | Accepted: a full storage says so; more room only when an app needs it |
| J-16 | Info     | Browser test helpers repeat storage formats and photo helpers by hand                                                        | Fixed: tests/e2e/storage.ts and photos.ts                             |
| J-17 | Info     | Flaky browser tests are retried in CI and never reported                                                                     | Explained: Playwright already lists flaky tests in each run’s summary |
| J-18 | Info     | The cache test for pages would pass for a page cached for a year                                                             | Fixed                                                                 |

#### Z. Anything else

| ID   | Severity | What was wrong                                                                                                   | What happened                                           |
| ---- | -------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Z-1  | Medium   | Anyone can lock everyone out of the online photo library with 20 requests an hour                                | Fixed                                                   |
| Z-2  | Medium   | After a deploy, a slow connection can leave an app that opens empty when offline                                 | Fixed                                                   |
| Z-3  | Medium   | Every build and every deploy needs a 361 MB download from one Hugging Face account                               | Fixed                                                   |
| Z-4  | Low      | A new app made with `pnpm new-app` or the "New app" workflow tells the privacy page it stores nothing            | Fixed                                                   |
| Z-5  | Low      | The template's browser test skips the shared checks (console errors and requests to other sites)                 | Fixed                                                   |
| Z-6  | Low      | The JavaScript size budget doesn't count imported files; Calendar and Tasks are over it                          | Fixed                                                   |
| Z-7  | Low      | The QR code encoder is a translation of an MIT-licensed library, without its copyright notice                    | Fixed                                                   |
| Z-8  | Low      | Deep check's licence file calls RoBERTa's files Apache 2.0 and leaves out their MIT notice                       | Fixed                                                   |
| Z-9  | Low      | On a phone set to another language, sentences mix English with that language, and the page says it's all English | Fixed                                                   |
| Z-10 | Low      | Right-to-left text shows its full stop or "!" at the wrong end                                                   | Fixed                                                   |
| Z-11 | Info     | Smaller points                                                                                                   | Fixed (the licence link); no LICENSE file (your choice) |
| Z-12 | Info     | The threat model has no goal for keeping things working                                                          | Fixed                                                   |

## Second audit

The second audit (25 October 2026) followed the same brief. Its findings were
fixed the same day, in
[#70](https://github.com/shkriuss/shkriuss.app/pull/70) to
[#77](https://github.com/shkriuss/shkriuss.app/pull/77). Its report isn't in
the repository, so this list is rebuilt from those pull requests: each fix
named its finding. That's why it has no severities, and why four numbers
(2E-2, 2G-2, 2I-2 and 2J-1) are missing: no fix named them.

### Left for you to decide

The defaults below stay until you say otherwise. Nothing breaks either way.

- **Undo after one-tap removals:** removing a drink in Water, a shopping list
  item or a planned meal in Meals, or a word from Grammar's dictionary
  happens at once, with no Undo. An Undo needs a new shared piece of the
  design system (a notice with a button). Left open in
  [#76](https://github.com/shkriuss/shkriuss.app/pull/76): say if you want it.
- **Shelf** shows web addresses in their own letters only for Georgian,
  Chinese, Japanese and Korean; others stay as punycode ("xn--…"), so a
  look-alike address can't pass for a real one. The list can be widened
  ([#74](https://github.com/shkriuss/shkriuss.app/pull/74)).
- **Notes** drops an empty new note once it has been left for 10 minutes
  ([#74](https://github.com/shkriuss/shkriuss.app/pull/74)).

### Every finding

| ID                          | What was wrong                                                                                                                            | Fixed in      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 2A-1                        | A lost device's old copy could stop the move to the new key, and every sync after it                                                      | #70           |
| 2A-2                        | "Done" left a device code working for its 10 minutes                                                                                      | #70           |
| 2A-3                        | A device signed in to someone else's account could move its old data there (Photos too)                                                   | #70           |
| 2A-4, 2C-1                  | Harmful code on any app page could use the account's passkey in Safari and Firefox (ADR 0018)                                             | #70           |
| 2B-1                        | A push address that never answers could use up the free daily server time of every app                                                    | #71           |
| 2B-2                        | A clean-up or deletion stopped for good after an error                                                                                    | #71           |
| 2D-1                        | So "forgotten after two days" and a deleted online library didn't always happen (fixed by 2B-2)                                           | #71           |
| 2D-2                        | Pull request previews looked exactly like the real site (previews were removed later: ADR 0019)                                           | #76           |
| 2E-1                        | A copy that unpacks to gigabytes crashed the app on every device                                                                          | #70           |
| 2E-3                        | A full browser was called "private mode or blocked"                                                                                       | #70           |
| 2F1-1                       | Water: drinking exactly the goal in fl oz didn't reach it                                                                                 | #75           |
| 2F1-2                       | Tasks, Calendar, Reminders, Habits: saving a form undid what had synced while it was open                                                 | #75           |
| 2F1-3                       | Calendar: saving an event deleted elsewhere meanwhile lost the edit                                                                       | #75           |
| 2F1-4                       | Water, Meals: a device with its clock far ahead deleted other devices' data                                                               | #75           |
| 2F1-5                       | Habits: check marks had no limit, and nothing but deleting a habit made room                                                              | #75           |
| 2F1-6                       | A reminder in the hour the clocks skip never went off in an open app                                                                      | #75           |
| 2F1-7                       | An open app didn't show a reminder the notification server didn't have yet                                                                | #75           |
| 2F1-8 to 2F1-11             | Calendar import: a huge DURATION, a crafted slow file, an all-day repeat's end, copies on re-import                                       | #75           |
| 2F1-12, 2F1-13              | Calendar: a new day went unnoticed on screen; saving worked out every event's days                                                        | #75           |
| 2F1-14                      | Tasks: ticking off a task with a huge "every" failed                                                                                      | #75           |
| 2F2-1, 2F2-5, 2F2-10        | Numbers weren't read the way the person's language writes them ("2,000" was saved as 2)                                                   | #72           |
| 2F2-2                       | Words in Hindi, Thai and other scripts counted as the same when a vowel sign differed                                                     | #72           |
| 2F2-3                       | Repairs allowed more repairs than fit on the device                                                                                       | #72           |
| 2F2-4                       | Trades: closing part of a trade on two devices counted shares twice                                                                       | #72           |
| 2F2-6                       | Names made twice by the first sync couldn't be changed                                                                                    | #72           |
| 2F2-7                       | Budget's month line counted spending in categories without a limit                                                                        | #72           |
| 2F2-8                       | A device on an older version deleted settings a newer version added                                                                       | #70, #73      |
| 2F2-9                       | Repairs kept photos no repair used                                                                                                        | #72           |
| 2F2-11 to 2F2-13            | "Spent -$0.00", 1.005 not rounding to 1.01, ∞ or NaN in Trades, decimals and part costs                                                   | #72           |
| 2F3-1, 2F3-2                | Photos: "Free up space" stopped half-way, or sync turned off mid-check, could lose photos                                                 | #74           |
| 2F3-3                       | Grammar, Notes, Shelf: a long paste was cut without a word                                                                                | #74           |
| 2F3-4, 2F3-5, 2F3-8, 2F3-11 | Grammar: the checker broke, Deep check downloaded twice, "Added" to a full dictionary, slow splitting                                     | #74           |
| 2F3-6, 2F3-9                | Notes: a sync kept both versions silently; cut emoji, the Pin button, empty notes left behind                                             | #74           |
| 2F3-7                       | Hub: "Replace your account key?" said a lost device's apps stop syncing                                                                   | #74           |
| 2F3-10                      | Shelf showed Georgian web addresses as punycode                                                                                           | #74           |
| 2G-1, 2G-12                 | Photos: no focus ring on a chosen photo; the selection bar went out of sight                                                              | #76           |
| 2G-3, 2G-5                  | Keyboard focus jumped to the top when a list was drawn again, or after some buttons                                                       | #76           |
| 2G-4, 2G-10                 | Large text didn't fit in several apps; Water's buttons broke words                                                                        | #76           |
| 2G-6, 2G-8, 2G-9            | Screen readers: searches not read out, Reminders read again every minute, dialogs said nothing                                            | #76           |
| 2G-7, 2G-13, 2G-14          | Contrast themes, a small "What sync sends" link, Water's day error, photo viewers                                                         | #76           |
| 2G-11                       | Account and Photos' library requests waited for ever on a network that hangs                                                              | #70           |
| 2H-1                        | The package-age check didn't refuse packages from outside npm (changed again by 3H-1)                                                     | #73           |
| 2H-2                        | Every check needed Playwright's download server                                                                                           | #73           |
| 2I-1, 2I-3                  | The docs didn't say what the rate limit can't stop, or about Cloudflare's own CAA entries                                                 | #73           |
| 2J-2                        | Nothing added up every app's server limits against the free plan                                                                          | #71           |
| 2J-3                        | No unit test pinned the security headers                                                                                                  | #73           |
| 2J-4                        | Renaming a live server migration failed only in the deploy                                                                                | #71           |
| 2J-5 to 2J-11, 2J-13        | Docs, and a registry check: CI's 30 minutes, "storage": "none", deploy times, removing an app, what to keep true, newcomers, old browsers | #70, #71, #73 |
| 2J-12                       | Code copied between apps (spreadsheets, paging, settings, photos, notifications)                                                          | #77           |
| 2J-14                       | Two tests could pass without checking anything                                                                                            | #73           |

## Third audit

### How it was done

- **Who:** Claude Code (25 October 2026), at commit `4b7d0c7`. It did areas
  A, B, E, H, I and Z itself, and separate reviews did C, D, F1, F2, F3, G
  and J; every finding they made was checked against the code again, the
  serious ones by running a test.
- **What:** as before: the code, the workflows, and the live sites and
  settings (read-only).
- **Evidence:** each finding came with a test or a command that shows it.
  Each fix comes with a test that fails without it, where one can be
  written.
- **Fixes:** in pull requests
  [#79](https://github.com/shkriuss/shkriuss.app/pull/79),
  [#80](https://github.com/shkriuss/shkriuss.app/pull/80),
  [#81](https://github.com/shkriuss/shkriuss.app/pull/81),
  [#82](https://github.com/shkriuss/shkriuss.app/pull/82),
  [#83](https://github.com/shkriuss/shkriuss.app/pull/83),
  [#84](https://github.com/shkriuss/shkriuss.app/pull/84),
  [#85](https://github.com/shkriuss/shkriuss.app/pull/85),
  [#86](https://github.com/shkriuss/shkriuss.app/pull/86),
  [#87](https://github.com/shkriuss/shkriuss.app/pull/87) and
  [#88](https://github.com/shkriuss/shkriuss.app/pull/88).

### Totals

| Severity | Found | Fixed | Your setting | Explained |
| -------- | ----- | ----- | ------------ | --------- |
| High     | 1     | 1     | –            | –         |
| Medium   | 10    | 10    | –            | –         |
| Low      | 48    | 47    | –            | 1         |
| Info     | 18    | 14    | –            | 4         |
| **All**  | 77    | 72    | –            | 5         |

### What's left for you

**Settings:** nothing that has to be done. 3I-2 is done (26 October): the
Web Analytics site is deleted, and Server-side Excludes needs nothing, as
Cloudflare retired it in June 2024. The two forwarding rules of 3I-1 can't
be deleted while Email Routing is off, and they do nothing then: leave it
off, and if it's ever turned on, delete them first
([deployment.md](../deployment.md)).

**If you want** (3I-3): the extra email records for each app's address, and
a Cloudflare account of its own for shkriuss.app, both in
[deployment.md](../deployment.md).

**Choices:** the second audit's Undo after one-tap removals is still open
([above](#left-for-you-to-decide)).

### Every finding

Severity is the auditor's, as in the first audit.

#### A. Account and keys

| ID   | Severity | What was wrong                                                                                       | What happened                                                                             |
| ---- | -------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 3A-1 | Low      | "Replace the account key" didn't stop reminders while closed on the lost device, and nothing said so | Fixed: the Account page, the privacy page and ADR 0010 say so, and how to stop them (#82) |
| 3A-2 | Info     | A server's answer alone made the browser forget a passkey                                            | Explained (ADR 0018): the recovery key still signs in (#80)                               |

#### B. Servers

| ID   | Severity | What was wrong                                                                                | What happened                                                                                 |
| ---- | -------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 3B-1 | Medium   | Repairs: deleting or moving a copy with photos could be undone by one failed internal request | Fixed (#79)                                                                                   |
| 3B-2 | Medium   | Four made-up devices could stop everyone's reminders while closed in an app, every day        | Fixed: 100 messages a device a day, and the big push services have a share of their own (#83) |
| 3B-3 | Low      | An old copy could be sent again as newer, and devices then deleted items                      | Fixed (#79)                                                                                   |
| 3B-4 | Low      | An alarm might stop for good when the free daily requests run out (suspicion)                 | Fixed: uploads and test messages set it again; ADR 0017 says what brings one back (#80, #83)  |
| 3B-5 | Info     | The online library's notes about deleted photos are never removed                             | Explained (ADR 0016): they have to stay (#81)                                                 |

#### C. Pages and the browser

| ID   | Severity | What was wrong                                                                  | What happened                                               |
| ---- | -------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 3C-1 | Low      | A backup with very deeply nested data stopped sync on that device for good      | Fixed (#79)                                                 |
| 3C-2 | Low      | A crafted calendar file far under 5 MB froze Calendar for minutes               | Fixed (#86)                                                 |
| 3C-3 | Low      | A change to the security headers alone didn't reach saved copies                | Fixed (#79)                                                 |
| 3C-4 | Low      | The header that turns passkeys off on app pages isn't a barrier, even in Chrome | Fixed: ADR 0018 says what really protects the account (#80) |
| 3C-5 | Low      | The build's CSP check missed a few unsafe forms                                 | Fixed (#79)                                                 |
| 3C-6 | Info     | "Save original" could cut an emoji in half in a long file name                  | Fixed (#81)                                                 |

#### D. Privacy and what the pages promise

| ID   | Severity | What was wrong                                                                                        | What happened                                                                                      |
| ---- | -------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 3D-1 | Medium   | An upload on its way turned reminders while closed back on after "Turn off" or "Delete all data"      | Fixed (#83)                                                                                        |
| 3D-2 | Low      | Photos' online library wasn't deleted when unused, though the privacy page said so                    | Fixed: the page says what happens, and a deleted library's leftovers go after 13 months (#81, #82) |
| 3D-3 | Low      | With storage full, "Turn off" never asked the server to delete the reminders                          | Fixed (#83)                                                                                        |
| 3D-4 | Low      | "Forgotten after two days of failures" happened only at the next reminder                             | Fixed (#83)                                                                                        |
| 3D-5 | Low      | The short texts of the 7 apps with reminders while closed left them out                               | Fixed (#82)                                                                                        |
| 3D-6 | Low      | The privacy page understated what the notification server keeps                                       | Fixed: the page lists it, and messages are padded (#82, #83)                                       |
| 3D-7 | Low      | The privacy page's "Last updated" date was old                                                        | Fixed: a test keeps it with the text (#82)                                                         |
| 3D-8 | Info     | Smaller privacy points (old passkey locks, the signing key, a scrambled address, a signed-out device) | Fixed (#81, #82, #83)                                                                              |

#### E. Saving and syncing data

| ID   | Severity | What was wrong                                                                                | What happened |
| ---- | -------- | --------------------------------------------------------------------------------------------- | ------------- |
| 3E-1 | Low      | When the sync state couldn't be saved after the data was, the next sync overwrote newer edits | Fixed (#79)   |

#### F1. Calendar, Tasks, Reminders, Habits, Water

| ID    | Severity | What was wrong                                                                               | What happened                                                        |
| ----- | -------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 3F1-1 | Medium   | Each repeat of a reminder reused its notification's name, so later ones likely came silently | Fixed (#83; not yet tried on a phone)                                |
| 3F1-2 | Low      | Calendar import's "may be an hour off" note missed repeats starting on a clock-change day    | Fixed, and times the clocks skip are read as the standard says (#86) |
| 3F1-3 | Low      | In the hour that repeats when clocks go back, the server picked another time than the page   | Fixed (#83)                                                          |
| 3F1-4 | Low      | "On" was shown when nothing could be saved or uploaded                                       | Fixed (#83)                                                          |
| 3F1-5 | Low      | Over 500 upcoming reminders, the rest were sent by nobody                                    | Fixed: the open app shows them, and says so (#83)                    |
| 3F1-6 | Low      | Calendar could show a reminder twice; Habits too after midnight                              | Fixed (#86)                                                          |
| 3F1-7 | Info     | The week might start on Monday in some browsers (suspicion)                                  | Explained (Calendar's README): where the browser can't tell (#86)    |

#### F2. Budget, Trades, Repairs, Meals, Tally

| ID     | Severity | What was wrong                                                                                   | What happened                                   |
| ------ | -------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| 3F2-1  | Medium   | A form open while another device changed the item saved the old values back; Repairs lost photos | Fixed (#84)                                     |
| 3F2-2  | Low      | Trades: "Delete a year" changed the open trade, and a later edit brought parts back              | Fixed (#84)                                     |
| 3F2-3  | Low      | "1.500" was saved as 1.50 where thousands are grouped with a space                               | Fixed: the app asks which (#84)                 |
| 3F2-4  | Low      | "12 50" was saved as 1,250                                                                       | Fixed, in Shelf too (#84)                       |
| 3F2-5  | Low      | Over the item limit, Budget and Trades refused every change                                      | Fixed (#84)                                     |
| 3F2-6  | Low      | Spreadsheets showed garbled letters in Excel                                                     | Fixed (#84)                                     |
| 3F2-7  | Low      | Meals cut long ingredient lines without a word                                                   | Fixed (#84)                                     |
| 3F2-8  | Low      | Repairs' messages for numbers over the most allowed were about something else                    | Fixed (#84)                                     |
| 3F2-9  | Info     | Meals' "shopping list is full" advice couldn't make room                                         | Fixed (#84)                                     |
| 3F2-10 | Info     | Trades counted a trade closed in parts as several                                                | Fixed: it says so, and parts follow fixes (#84) |
| 3F2-11 | Info     | A fix without a test, a loose check, a comment that overstated                                   | Fixed (#84)                                     |

#### F3. Notes, Shelf, Grammar, Photos

| ID    | Severity | What was wrong                                                                   | What happened                                                                            |
| ----- | -------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 3F3-1 | High     | Photos deleted everywhere a photo deleted while sync was off                     | Fixed: with sync off, a photo is deleted only on that device (#81)                       |
| 3F3-2 | Medium   | Grammar's Deep check turned "I dont know" into "I do know"                       | Fixed (#85)                                                                              |
| 3F3-3 | Medium   | Photos picked on an iPhone likely arrive as JPEG copies, not the originals       | Fixed: the app says so there, and how to keep originals (#81; not yet tried on a device) |
| 3F3-4 | Low      | Notes kept two "(second version)" notes after a sync while typing                | Fixed (#82)                                                                              |
| 3F3-5 | Low      | Deep check wrote "it ’s" with curly apostrophes                                  | Fixed (#85)                                                                              |
| 3F3-6 | Low      | Grammar's dictionary kept uploading again between devices set to other languages | Fixed (#85)                                                                              |
| 3F3-7 | Low      | Shelf's price sort ordered items without a price by a hidden currency            | Fixed (#82)                                                                              |
| 3F3-8 | Low      | Photos said "No photos yet" while a big library loaded                           | Fixed, with a race behind it (#81)                                                       |
| 3F3-9 | Info     | Smaller points in Shelf, Grammar and Photos                                      | Fixed (#81, #82, #85)                                                                    |

#### G. Accessibility

| ID    | Severity | What was wrong                                                                 | What happened                                                      |
| ----- | -------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 3G-1  | Medium   | Photos and Grammar sent keyboard focus to the top when a list was drawn again  | Fixed (#81, #85)                                                   |
| 3G-2  | Low      | Tasks' "My order" didn't fit large text                                        | Fixed (#86)                                                        |
| 3G-3  | Low      | Other redraws still lost focus or sent it to the wrong place                   | Fixed (#82, #84, #86)                                              |
| 3G-4  | Low      | The Restore dialog's passphrase error wasn't read out after Enter              | Fixed (#83)                                                        |
| 3G-5  | Low      | Water's goal and sizes refused a value without a word                          | Fixed (#86)                                                        |
| 3G-6  | Low      | An edit form closed without a word when its item was deleted elsewhere         | Fixed (#84, #86)                                                   |
| 3G-7  | Low      | "Download Deep check" went silent for good while the network hung              | Fixed (#85)                                                        |
| 3G-8  | Low      | Photos from the same minute shared one name; Next and Previous said nothing    | Fixed (#81, #84)                                                   |
| 3G-9  | Low      | Name buttons as narrow as 9 px                                                 | Fixed (#82, #84)                                                   |
| 3G-10 | Low      | Calendar's month heading was read out on every redraw (suspicion)              | Fixed (#86)                                                        |
| 3G-11 | Info     | Things said twice, an open decision not recorded, overdue shown by colour only | Fixed (#83, #86; the decision is [above](#left-for-you-to-decide)) |

#### H. CI and deploys

| ID   | Severity | What was wrong                                                                      | What happened                  |
| ---- | -------- | ----------------------------------------------------------------------------------- | ------------------------------ |
| 3H-1 | Medium   | The lockfile check let a pull request swap any package for a download from anywhere | Fixed (#79)                    |
| 3H-2 | Info     | Any code that runs in a CI job can read that job's secrets                          | Explained (`SECURITY.md`, #79) |

#### I. Domain and Cloudflare

| ID   | Severity | What was wrong                                                  | What happened                                                                                                         |
| ---- | -------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 3I-1 | Low      | The two email forwarding rules were still there                 | Explained ([above](#whats-left-for-you)): they can't be deleted while Email Routing is off, and do nothing then (#88) |
| 3I-2 | Info     | A Web Analytics site and Server-side Excludes were still set up | Fixed (your setting, 26 October); Cloudflare retired Server-side Excludes in 2024 (#88)                               |
| 3I-3 | Info     | Smaller hardening steps                                         | Fixed: `security.txt` on every site (#80); the rest is optional, your setting (#87)                                   |

#### J. Architecture and tests

| ID    | Severity | What was wrong                                                              | What happened                                                                                                         |
| ----- | -------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 3J-1  | Medium   | No test covered the sync rule that stops two devices overwriting each other | Fixed (#79)                                                                                                           |
| 3J-2  | Low      | The second audit wasn't recorded, and its numbers clashed with the first's  | Fixed: this page (#87)                                                                                                |
| 3J-3  | Low      | No test checked that the servers refuse our own other subdomains            | Fixed (#79, #82)                                                                                                      |
| 3J-4  | Low      | Numbers the docs promise could change without any test failing              | Fixed (#79, #81, #82, #83)                                                                                            |
| 3J-5  | Low      | Some unit tests passed only on a computer set to English                    | Fixed, and CI runs them in German too (#81, #84, #87)                                                                 |
| 3J-6  | Low      | ADR 0017 and PLAN.md said only two more apps fit; it's about eight          | Fixed (#80)                                                                                                           |
| 3J-7  | Low      | Nothing checked that Deep check's files reach the live site                 | Fixed (#79)                                                                                                           |
| 3J-8  | Info     | Small doc slips                                                             | Fixed (#80, #83, #85)                                                                                                 |
| 3J-9  | Info     | Repairs' page script had grown back to one 910-line function                | Fixed (#84)                                                                                                           |
| 3J-10 | Info     | What a newcomer needs that no doc said                                      | Fixed (#80)                                                                                                           |
| 3J-11 | Info     | What will be hard to change later                                           | Fixed: Calendar has room again (#83, #86), Harper's size is planned for (#85), the shared tests name every site (#87) |
| 3J-12 | Info     | Small helpers copied between apps, and "same name" checks that differ       | Fixed (#84, #86, #87)                                                                                                 |

## Fourth audit

### How it was done

- **Who:** Claude Code (26 October 2026), at commit `7e11f89`. It did areas
  A, B, E, H, I and Z itself, and separate reviews did C, D, F1, F2, F3, G
  and J; every finding they made was checked against the code again, by
  running its test or reading the code it points to. Each batch of fixes was
  then read again by a separate review before it was merged (the second
  batch's just after, so its follow-ups are in #93), which found problems in
  the first versions of the fixes; those are fixed too. Fixing them turned up
  a few more, outside the audit's list (a sync message that gave the wrong
  reason, and browser tests that failed now and then), fixed in the same
  pull requests.
- **What:** as before: the code, the workflows, and the live sites and
  settings (read-only).
- **Evidence:** each finding came with a test or a command that shows it.
  Each fix comes with a test that fails without it, where one can be
  written.
- **Fixes:** in pull requests
  [#89](https://github.com/shkriuss/shkriuss.app/pull/89),
  [#90](https://github.com/shkriuss/shkriuss.app/pull/90),
  [#91](https://github.com/shkriuss/shkriuss.app/pull/91),
  [#92](https://github.com/shkriuss/shkriuss.app/pull/92) and
  [#93](https://github.com/shkriuss/shkriuss.app/pull/93).

### Totals

| Severity | Found | Fixed | Partly fixed | Explained |
| -------- | ----- | ----- | ------------ | --------- |
| High     | –     | –     | –            | –         |
| Medium   | 8     | 8     | –            | –         |
| Low      | 47    | 45    | 1            | 1         |
| Info     | 23    | 20    | –            | 3         |
| **All**  | 78    | 73    | 1            | 4         |

There were no Critical or High findings: no way was found for anyone to read
or change someone else's data, take over an account, run code on the sites,
or run up costs. Area I (the domain, Cloudflare and GitHub settings) matched
the docs, so it has no findings.

### What's left for you

**Settings:** nothing.

**Choices made for you, which you can change:**

- Meals keeps fewer things than before, so that a full Meals fits on an
  iPhone (4F2-13): 2,000 planned meals instead of 5,000, 500 things added to
  shopping lists by hand instead of 2,000, and 600,000 characters of text in
  all its meals together (about 300 meals with a long recipe each). What's
  saved already stays.
- A one-off reminder set during the hour that repeats when clocks go back,
  for later in that same hour, still doesn't go off (4F1-7): sending it the
  second time round would need the phone and the server to remember which
  reminders went off the first time, or those would come twice. It can only
  happen in one hour a year ([ADR 0009](../adr/0009-push-notifications.md)).
- Two bigger pieces of work are planned rather than done (4J-10): splitting
  the biggest page scripts, and loading Photos' list a page at a time
  ([PLAN.md](../PLAN.md), Milestone 2).

The second audit's Undo after one-tap removals is still open
([above](#left-for-you-to-decide)).

### Every finding

Severity is the auditor's, as before.

#### A. Account and keys

| ID   | Severity | What was wrong                                                                           | What happened                                                                                                                                  |
| ---- | -------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 4A-1 | Low      | An app connected to a different account still moved the first account's old copies there | Fixed ([#89](https://github.com/shkriuss/shkriuss.app/pull/89))                                                                                |
| 4A-2 | Info     | The check on adding a passkey's lock can't tell who made the lock                        | Explained ([ADR 0018](../adr/0018-passkey-signatures.md)): what the signature proves ([#89](https://github.com/shkriuss/shkriuss.app/pull/89)) |

#### B. Servers

| ID   | Severity | What was wrong                                                                | What happened                                                                                                                            |
| ---- | -------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 4B-1 | Info     | Device links weren't counted by any storage meter, and ADR 0017 didn't say so | Explained ([ADR 0017](../adr/0017-storage-limits.md)): why they don't need one ([#89](https://github.com/shkriuss/shkriuss.app/pull/89)) |

#### C. Browser security

| ID   | Severity | What was wrong                                                                            | What happened                                                                                                                                  |
| ---- | -------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 4C-1 | Low      | Before a page's script ran, its form sent what was typed to the server, in the address    | Fixed: forms can't be sent anywhere ([#90](https://github.com/shkriuss/shkriuss.app/pull/90))                                                  |
| 4C-2 | Low      | One photo whose type is "constructor" emptied the Photos grid on every device that got it | Fixed ([#90](https://github.com/shkriuss/shkriuss.app/pull/90))                                                                                |
| 4C-3 | Low      | Calendar's import froze the page: 17 seconds for a crafted file, about 2 for a big one    | Fixed: read in a worker, at most 5,000 events ([#91](https://github.com/shkriuss/shkriuss.app/pull/91))                                        |
| 4C-4 | Low      | A change to the security headers didn't reach saved worker scripts                        | Fixed ([#90](https://github.com/shkriuss/shkriuss.app/pull/90), [#93](https://github.com/shkriuss/shkriuss.app/pull/93))                       |
| 4C-5 | Low      | The service worker showed a 4xx error instead of the saved copy of a page                 | Fixed ([#90](https://github.com/shkriuss/shkriuss.app/pull/90); its test made real in [#93](https://github.com/shkriuss/shkriuss.app/pull/93)) |
| 4C-6 | Low      | "Add this device" might be clickable through a double-click trick                         | Fixed: it works only half a second after it shows ([#89](https://github.com/shkriuss/shkriuss.app/pull/89))                                    |
| 4C-7 | Info     | In Firefox, all the apps share one storage limit                                          | Explained in Photos' README ([#90](https://github.com/shkriuss/shkriuss.app/pull/90))                                                          |

#### D. Privacy

| ID   | Severity | What was wrong                                                                                  | What happened                                                                                                    |
| ---- | -------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 4D-1 | Low      | A deleted Photos library was filled again by another device still uploading                     | Fixed ([#89](https://github.com/shkriuss/shkriuss.app/pull/89))                                                  |
| 4D-2 | Low      | "Delete the online copy" before a device's first sync had finished left the online library      | Fixed ([#89](https://github.com/shkriuss/shkriuss.app/pull/89))                                                  |
| 4D-3 | Low      | The privacy page left Microsoft out of the push services that carry reminders                   | Fixed ([#89](https://github.com/shkriuss/shkriuss.app/pull/89))                                                  |
| 4D-4 | Low      | Photos' "Delete all data?" said to back up first, but Photos has no backup                      | Fixed ([#89](https://github.com/shkriuss/shkriuss.app/pull/89))                                                  |
| 4D-5 | Low      | A passkey deleted in the password manager leaves its lock on the server, which wasn't said      | Fixed: the privacy page says so, and how to remove one ([#89](https://github.com/shkriuss/shkriuss.app/pull/89)) |
| 4D-6 | Low      | On an iPhone, turning notifications off in Settings might not delete anything on the server     | Fixed ([#89](https://github.com/shkriuss/shkriuss.app/pull/89))                                                  |
| 4D-7 | Info     | A few things the servers keep weren't in the privacy page's lists                               | Fixed ([#89](https://github.com/shkriuss/shkriuss.app/pull/89))                                                  |
| 4D-8 | Info     | Words removed from Grammar's dictionary, and imported events' file ids, stay 180 days with sync | Fixed: the privacy page says so ([#89](https://github.com/shkriuss/shkriuss.app/pull/89))                        |

#### E. Data safety

| ID   | Severity | What was wrong                                                                         | What happened                                                   |
| ---- | -------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 4E-1 | Medium   | After "Delete the online copy", sync could never be turned on again for that app       | Fixed ([#89](https://github.com/shkriuss/shkriuss.app/pull/89)) |
| 4E-2 | Low      | A refused restore said "Nothing was changed", but had erased the device's sync history | Fixed ([#89](https://github.com/shkriuss/shkriuss.app/pull/89)) |

#### F1. Time and reminders

| ID     | Severity | What was wrong                                                                                                  | What happened                                                                                                       |
| ------ | -------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 4F1-1  | Medium   | After the clock went back by hours (flying west), open apps showed no reminders until it caught up              | Fixed ([#91](https://github.com/shkriuss/shkriuss.app/pull/91))                                                     |
| 4F1-2  | Low      | The notification server could stop sending a device's reminders while the app believed it had them              | Fixed: the app asks the server daily ([#91](https://github.com/shkriuss/shkriuss.app/pull/91))                      |
| 4F1-3  | Low      | Calendar and Tasks: in an editor whose item was deleted elsewhere, Delete did nothing, and Save brought it back | Fixed ([#91](https://github.com/shkriuss/shkriuss.app/pull/91))                                                     |
| 4F1-4  | Low      | "N minutes before" reminders in the hour clocks skip went off after the event had started                       | Fixed ([#91](https://github.com/shkriuss/shkriuss.app/pull/91))                                                     |
| 4F1-5  | Low      | Habits and Water: a reminder at midnight came twice with reminders while closed on                              | Fixed ([#91](https://github.com/shkriuss/shkriuss.app/pull/91))                                                     |
| 4F1-6  | Low      | Habits, Tasks, Reminders and Water open in two tabs rang twice for each reminder                                | Fixed ([#91](https://github.com/shkriuss/shkriuss.app/pull/91))                                                     |
| 4F1-7  | Low      | A one-off reminder set during the hour that repeats, for later in that hour, never goes off                     | Explained ([above](#whats-left-for-you-1)): a known limit ([#91](https://github.com/shkriuss/shkriuss.app/pull/91)) |
| 4F1-8  | Low      | Reminders: an overdue reminder's text couldn't be corrected without moving its time                             | Fixed ([#91](https://github.com/shkriuss/shkriuss.app/pull/91))                                                     |
| 4F1-9  | Low      | Water: switching units could turn days that reached the goal into "not reached"                                 | Fixed ([#91](https://github.com/shkriuss/shkriuss.app/pull/91))                                                     |
| 4F1-10 | Low      | Calendar's import cut long titles and notes in the middle of an emoji                                           | Fixed ([#91](https://github.com/shkriuss/shkriuss.app/pull/91))                                                     |
| 4F1-11 | Info     | Habits, Water and Budget skipped a reminder from just before midnight when the page woke just after             | Fixed ([#91](https://github.com/shkriuss/shkriuss.app/pull/91))                                                     |
| 4F1-12 | Info     | A calendar file cut off in the middle of an event dropped that event without a word                             | Fixed ([#91](https://github.com/shkriuss/shkriuss.app/pull/91))                                                     |
| 4F1-13 | Info     | The behaviour behind 4F1-1 to 4F1-7 had no test                                                                 | Fixed ([#91](https://github.com/shkriuss/shkriuss.app/pull/91))                                                     |

#### F2. Money apps, Tally, Meals and Repairs

| ID     | Severity | What was wrong                                                                                    | What happened                                                                                                                           |
| ------ | -------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 4F2-1  | Medium   | "Delete a year…" deleted a different year if the chosen one was deleted elsewhere meanwhile       | Fixed ([#92](https://github.com/shkriuss/shkriuss.app/pull/92))                                                                         |
| 4F2-2  | Medium   | Repairs froze about a second at every redraw near its limit                                       | Fixed ([#92](https://github.com/shkriuss/shkriuss.app/pull/92))                                                                         |
| 4F2-3  | Low      | Tally lost a count when two devices counted the same number of times before they synced           | Fixed ([#92](https://github.com/shkriuss/shkriuss.app/pull/92))                                                                         |
| 4F2-4  | Low      | Meals: changing a planned meal removed elsewhere saved nothing, and still said "Changed …"        | Fixed ([#92](https://github.com/shkriuss/shkriuss.app/pull/92))                                                                         |
| 4F2-5  | Low      | Budget: after switching to yen, amounts didn't add up to what's shown                             | Fixed ([#92](https://github.com/shkriuss/shkriuss.app/pull/92))                                                                         |
| 4F2-6  | Low      | Trades: "Delete a year" could put closed shares back as open                                      | Fixed ([#92](https://github.com/shkriuss/shkriuss.app/pull/92))                                                                         |
| 4F2-7  | Low      | Long pastes into notes were cut without a word                                                    | Partly fixed: every box says so but Repairs' part rows, whose boxes are short ([#92](https://github.com/shkriuss/shkriuss.app/pull/92)) |
| 4F2-8  | Low      | Repairs: a photo taken off a repair was deleted before the repair was saved                       | Fixed ([#92](https://github.com/shkriuss/shkriuss.app/pull/92))                                                                         |
| 4F2-9  | Low      | Spreadsheets in a language that writes decimals with a comma: one column, and a formula could run | Fixed ([#92](https://github.com/shkriuss/shkriuss.app/pull/92))                                                                         |
| 4F2-10 | Low      | Trades on an iPhone whose keypad offers only a comma                                              | Fixed ([#92](https://github.com/shkriuss/shkriuss.app/pull/92))                                                                         |
| 4F2-11 | Low      | Repairs said "1 hours"                                                                            | Fixed ([#92](https://github.com/shkriuss/shkriuss.app/pull/92))                                                                         |
| 4F2-12 | Info     | Trades' fees weren't asked about for "1.500", as Budget and Repairs do                            | Fixed ([#92](https://github.com/shkriuss/shkriuss.app/pull/92))                                                                         |
| 4F2-13 | Info     | Meals' limits weren't measured against the room on the device                                     | Fixed: measured, and two limits lowered ([above](#whats-left-for-you-1)) ([#92](https://github.com/shkriuss/shkriuss.app/pull/92))      |

#### F3. Notes, Shelf, Photos and Grammar

| ID    | Severity | What was wrong                                                                        | What happened                                                                                                                                        |
| ----- | -------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4F3-1 | Medium   | Notes (and Shelf): with storage full, a change saved elsewhere wiped what was typed   | Fixed ([#93](https://github.com/shkriuss/shkriuss.app/pull/93))                                                                                      |
| 4F3-2 | Medium   | Grammar's Deep check garbled sentences with "constructor" or "toString"               | Fixed ([#90](https://github.com/shkriuss/shkriuss.app/pull/90))                                                                                      |
| 4F3-3 | Medium   | Photos dated HEIC (and every non-JPEG) photo by the file's date                       | Fixed ([#90](https://github.com/shkriuss/shkriuss.app/pull/90); quick with crafted files in [#93](https://github.com/shkriuss/shkriuss.app/pull/93)) |
| 4F3-4 | Low      | On iPhones, Notes and Shelf cut text that Safari's boxes let in                       | Fixed, in Tasks and notifications too ([#93](https://github.com/shkriuss/shkriuss.app/pull/93))                                                      |
| 4F3-5 | Low      | Shelf: category forms did nothing, or the wrong thing, after a deletion elsewhere     | Fixed ([#93](https://github.com/shkriuss/shkriuss.app/pull/93))                                                                                      |
| 4F3-6 | Info     | Search didn't find full-width or half-width letters                                   | Fixed ([#93](https://github.com/shkriuss/shkriuss.app/pull/93))                                                                                      |
| 4F3-7 | Info     | Grammar: a suggestion's surrounding text could start or end in the middle of an emoji | Fixed ([#90](https://github.com/shkriuss/shkriuss.app/pull/90))                                                                                      |

#### G. Accessibility and wording

| ID    | Severity | What was wrong                                                                                                              | What happened                                                                                          |
| ----- | -------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 4G-1  | Low      | Water's amount fields dropped a comma: "8,5" fl oz was saved as 85                                                          | Fixed ([#92](https://github.com/shkriuss/shkriuss.app/pull/92))                                        |
| 4G-2  | Low      | Anything read out while a dialog was open was never heard, such as a reminder                                               | Fixed: every dialog has its own message area ([#91](https://github.com/shkriuss/shkriuss.app/pull/91)) |
| 4G-3  | Low      | Calendar: a repeating event listed several times in "Next 7 days" lost its place                                            | Fixed ([#91](https://github.com/shkriuss/shkriuss.app/pull/91))                                        |
| 4G-4  | Low      | Account page: signing out or in from another tab changed this tab silently                                                  | Fixed ([#89](https://github.com/shkriuss/shkriuss.app/pull/89))                                        |
| 4G-5  | Low      | Repairs: over 30 parts, the problem wasn't read out                                                                         | Fixed ([#92](https://github.com/shkriuss/shkriuss.app/pull/92))                                        |
| 4G-6  | Low      | Photos' "Unlock online storage", the Account page's "Sign in" and "Send a test notification" said nothing while they waited | Fixed ([#90](https://github.com/shkriuss/shkriuss.app/pull/90))                                        |
| 4G-7  | Low      | "Also remind me when … is closed" could wait for ever on "Turning on…"                                                      | Fixed ([#91](https://github.com/shkriuss/shkriuss.app/pull/91))                                        |
| 4G-8  | Low      | The status line for reminders while closed was written again with the same words                                            | Fixed ([#91](https://github.com/shkriuss/shkriuss.app/pull/91))                                        |
| 4G-9  | Info     | Trades: another period in "Results for" changed every result without a word                                                 | Fixed ([#92](https://github.com/shkriuss/shkriuss.app/pull/92))                                        |
| 4G-10 | Info     | In Windows contrast themes, Calendar's "today" was only bold                                                                | Fixed ([#91](https://github.com/shkriuss/shkriuss.app/pull/91))                                        |
| 4G-11 | Info     | Tally's − and + buttons didn't fit the counter card with text at 200%                                                       | Fixed ([#92](https://github.com/shkriuss/shkriuss.app/pull/92))                                        |
| 4G-12 | Info     | The same action had different words, and "can't be undone" was in some delete dialogs only                                  | Fixed ([#93](https://github.com/shkriuss/shkriuss.app/pull/93))                                        |

#### H. CI, deploys and supply chain

| ID   | Severity | What was wrong                                                              | What happened                                                                |
| ---- | -------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 4H-1 | Info     | The lockfile age check took its exceptions from the pull request it checked | Fixed: from `main` ([#89](https://github.com/shkriuss/shkriuss.app/pull/89)) |

#### J. Architecture and tests

| ID    | Severity | What was wrong                                                                      | What happened                                                                                                                                                 |
| ----- | -------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4J-1  | Medium   | Photos sorted the whole library again for every change, including after each upload | Fixed ([#90](https://github.com/shkriuss/shkriuss.app/pull/90); adding one photo too in [#93](https://github.com/shkriuss/shkriuss.app/pull/93))              |
| 4J-2  | Low      | Shared browser tests skipped instead of failing, and nothing required "Your data"   | Fixed ([#93](https://github.com/shkriuss/shkriuss.app/pull/93))                                                                                               |
| 4J-3  | Low      | Nothing automated held the Safari 16.4 floor                                        | Fixed: the type check and `check:dist` hold the code to what Safari 16.4 runs ([#93](https://github.com/shkriuss/shkriuss.app/pull/93))                       |
| 4J-4  | Low      | The privacy page's "Last updated" check didn't see most of what the page says       | Fixed ([#89](https://github.com/shkriuss/shkriuss.app/pull/89))                                                                                               |
| 4J-5  | Low      | No test covered a photo that can't be saved because the device is full              | Fixed ([#90](https://github.com/shkriuss/shkriuss.app/pull/90))                                                                                               |
| 4J-6  | Low      | The JavaScript budget was nearly used up, and ADR 0007 named the wrong biggest page | Fixed ([#92](https://github.com/shkriuss/shkriuss.app/pull/92))                                                                                               |
| 4J-7  | Info     | adding-an-app.md's "What the generator does" was out of date                        | Fixed ([#93](https://github.com/shkriuss/shkriuss.app/pull/93))                                                                                               |
| 4J-8  | Info     | The sync browser tests' "never reaches the server readable" checks couldn't fail    | Fixed ([#93](https://github.com/shkriuss/shkriuss.app/pull/93))                                                                                               |
| 4J-9  | Info     | What a newcomer (or an AI session) needs that no doc said                           | Fixed ([#93](https://github.com/shkriuss/shkriuss.app/pull/93))                                                                                               |
| 4J-10 | Info     | What will be hard to change later                                                   | Fixed: "Reload the page" after an update ([#93](https://github.com/shkriuss/shkriuss.app/pull/93)); the rest is planned ([above](#whats-left-for-you-1))      |
| 4J-11 | Info     | Small helpers still copied between apps                                             | Fixed ([#93](https://github.com/shkriuss/shkriuss.app/pull/93)); the iPhone check stays in two places, as the notification code can't use the design system's |

#### Z. Anything else

| ID   | Severity | What was wrong                                                          | What happened                                                                                                |
| ---- | -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 4Z-1 | Info     | The brief's security goals 4 and 8 promised what the free plan can't do | Fixed: the brief names it as an accepted exception ([#89](https://github.com/shkriuss/shkriuss.app/pull/89)) |

## Fifth audit

### How it was done

- **Who:** Claude Code (27 October 2026), at commit `9f382e9`. It did area I
  (the live domain, Cloudflare and GitHub settings) itself, and separate
  reviews did A, B, C, D, E, F1, F2, F3, G, H, J and Z; every finding was
  checked against the code again (its proof test run, or the code it points
  to read) before anything was changed. The fixes were made in six batches
  by separate sessions, and each batch was read again before it was merged
  (the app batches by a separate review), which found a few problems in the
  first versions of the fixes: a step still lost in one Tasks case, big
  trades with decimals, a photo's files left behind on a full device. Those
  are fixed in the same pull requests.
- **What:** as before: the code, the workflows, and the live sites and
  settings (read-only).
- **Evidence:** each finding came with a test or a command that shows it.
  Each fix comes with a test that fails without it, where one can be
  written.
- **Fixes:** in pull requests ([#94](https://github.com/shkriuss/shkriuss.app/pull/94)) (CI, deploys, supply chain and docs),
  ([#95](https://github.com/shkriuss/shkriuss.app/pull/95)) (the browser platform, storage, data controls and backups), ([#96](https://github.com/shkriuss/shkriuss.app/pull/96))
  (sync, the account, the servers and the privacy page), ([#97](https://github.com/shkriuss/shkriuss.app/pull/97)) (Calendar,
  Reminders, Habits, Tasks and Water), ([#98](https://github.com/shkriuss/shkriuss.app/pull/98)) (Budget, Trades, Repairs, Meals
  and Tally) and ([#99](https://github.com/shkriuss/shkriuss.app/pull/99)) (Notes, Shelf, Grammar and Photos). This page, the
  brief's own corrections (5J-7) and PLAN.md's line counts (5J-3) come in a
  pull request of their own.

### Totals

| Severity | Found | Fixed | Partly fixed | Explained |
| -------- | ----- | ----- | ------------ | --------- |
| High     | –     | –     | –            | –         |
| Medium   | 8     | 8     | –            | –         |
| Low      | 42    | 40    | –            | 2         |
| Info     | 31    | 27    | –            | 4         |
| **All**  | 81    | 75    | –            | 6         |

There were no Critical or High findings: no way was found for anyone to read
or change someone else's data, take over an account, run code on the sites,
or run up costs. The eight Medium findings were about data that could go
wrong quietly (an edit made with no connection dated too late, "Turn off"
that didn't, a replaced key reaching the data again, a trade that could
never be closed), two ways a stranger could make the servers keep something
for good, a one-year cache header on a "not found" answer, and lockfile
checks that could be got around.

### What's left for you

**Settings** (all described in [deployment.md](../deployment.md)):

- After the browser platform pull request is live, the check after the
  deploy compares each site's `robots.txt` with the one it ships (5I-1). If
  that check fails, Cloudflare's managed `robots.txt` is still adding its
  text: turn it off under **Security → Settings → Bot traffic**.
- Once: **Actions → Keep caches → Run workflow**, then look at **Actions →
  Caches** (5H-2). Grammar's model has one download source (Hugging Face)
  and CI's cache as the only copy; a second source needs a copy you
  control ([ADR 0012](../adr/0012-deep-check-ai-model.md) says what).
- Optional: **Require branches to be up to date before merging** in the
  `main` ruleset (5I-3), with the cost it brings; **Zone Holds** for
  shkriuss.app and the auto-renew switch of each other domain in the
  account (5I-4); and the two leftover Email Routing rules, which can be
  deleted through Cloudflare's API with a token that may edit them (5I-2).

**Choices made for you, which you can change:**

- A sync round still re-reads every synced store (5J-1): about 50 ms a
  minute on the biggest apps. Skipping it safely has to key on the store's
  text and the whole sync state together, which is more than a small change
  should carry.
- A note that a photo was deleted online stays sealed for the photo's id,
  not for one upload of it (5A-2): a server that was restored or tampered
  with could replay it after the photo is added again. The fix needs
  Photos' photo record to keep something of each upload
  ([ADR 0016](../adr/0016-online-photo-library.md)).
- Two tabs of one app writing in the same few milliseconds as a sync's save
  step can still lose a write (5E-9): stopping that needs a lock around
  every save in every app ([ADR 0010](../adr/0010-account-and-sync.md)).
- After an account key is replaced, an app in which nobody turned sync on
  again for over 13 months, whose old copy nobody used meanwhile, could
  still bring along a copy the old key started in between (the narrowest
  case of 5A-1, [ADR 0017](../adr/0017-storage-limits.md)).
- Helpers copied between apps (the "every typed word" search, `later` and
  `whenIdle`, counting characters as an iPhone does, a message read out
  again) are planned for the design system, as one change
  ([PLAN.md](../PLAN.md), 5J-9).

The second audit's Undo after one-tap removals is still open
([above](#left-for-you-to-decide)).

### Every finding

Severity is the auditor's, as before.

#### A. Account and keys

| ID   | Severity | What was wrong                                                                                                                                                   | What happened                                                                                                                                                                                      |
| ---- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5A-1 | Medium   | A replaced account key reached the data again after the 13-month clean-up: the replacing device kept the old key for ever, and the server's "moved" note expired | Fixed ([#96](https://github.com/shkriuss/shkriuss.app/pull/96)); its narrowest case stays ([above](#whats-left-for-you-2))                                                                         |
| 5A-2 | Low      | A photo's deletion note could be replayed after "Delete the online copy" and a re-add, deleting the photo everywhere (a malicious or restored server)            | Explained ([ADR 0016](../adr/0016-online-photo-library.md)): a fix needs Photos' photo record to change ([above](#whats-left-for-you-2)) ([#96](https://github.com/shkriuss/shkriuss.app/pull/96)) |
| 5A-3 | Low      | A connect link with a key that isn't a curve point left the Account page's confirm button busy for good                                                          | Fixed ([#96](https://github.com/shkriuss/shkriuss.app/pull/96))                                                                                                                                    |
| 5A-4 | Info     | A crafted backup file (an undecodable salt) got "Something went wrong" instead of the backup wording (same as 5E-6)                                              | Fixed ([#95](https://github.com/shkriuss/shkriuss.app/pull/95))                                                                                                                                    |
| 5A-5 | Info     | The "turn sync off" proof in the hub's link was a permanent capability that lands in browser history                                                             | Fixed: it's for the day ([#96](https://github.com/shkriuss/shkriuss.app/pull/96))                                                                                                                  |

#### B. Servers and the bill

| ID   | Severity | What was wrong                                                                                                               | What happened                                                                                                                |
| ---- | -------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 5B-1 | Medium   | A library made up through the `move` route never got a clean-up alarm, so strangers could fill Photos' library room for good | Fixed ([#96](https://github.com/shkriuss/shkriuss.app/pull/96))                                                              |
| 5B-2 | Medium   | A device link whose expiry alarm Cloudflare gives up on stayed for good, and nothing counted links                           | Fixed: every link is a row in one object, swept at each request ([#96](https://github.com/shkriuss/shkriuss.app/pull/96))    |
| 5B-3 | Low      | The sync files meter counted only the files' bytes; the smallest files took six times the room it saw                        | Fixed ([#96](https://github.com/shkriuss/shkriuss.app/pull/96))                                                              |
| 5B-4 | Info     | The free plan's row writes run out far sooner than its requests, and no doc or test said so                                  | Fixed: ADRs 0010 and 0017 say so, with the counts pinned by a test ([#96](https://github.com/shkriuss/shkriuss.app/pull/96)) |

#### C. Pages and the browser

| ID   | Severity | What was wrong                                                                                      | What happened                                                                                                                                                                          |
| ---- | -------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5C-1 | Low      | A headers-only deploy didn't reach a worker script the browser's own cache held for a year          | Fixed ([#95](https://github.com/shkriuss/shkriuss.app/pull/95))                                                                                                                        |
| 5C-2 | Info     | Offline, a page address without its trailing slash showed "Page not found"                          | Fixed ([#95](https://github.com/shkriuss/shkriuss.app/pull/95))                                                                                                                        |
| 5C-3 | Info     | A few newer browser features weren't named in the Permissions-Policy                                | Fixed ([#95](https://github.com/shkriuss/shkriuss.app/pull/95))                                                                                                                        |
| 5C-4 | Info     | Any website could start an app's connect flow, or make it say "Sync is off", with a link (harmless) | Fixed for "off" (an app already off says nothing); the connect link explained in [ADR 0010](../adr/0010-account-and-sync.md) ([#96](https://github.com/shkriuss/shkriuss.app/pull/96)) |

#### D. Privacy and what the pages promise

| ID   | Severity | What was wrong                                                                                                                                                                                      | What happened                                                                                                                                                                     |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5D-1 | Low      | "Delete all data" left the reminders check behind in six apps, and their privacy lines didn't list it                                                                                               | Fixed ([#95](https://github.com/shkriuss/shkriuss.app/pull/95); the privacy lines in [#96](https://github.com/shkriuss/shkriuss.app/pull/96))                                     |
| 5D-2 | Low      | A second Notes tab with typing waiting to be saved put the note back right after "Delete all data"                                                                                                  | Fixed ([#99](https://github.com/shkriuss/shkriuss.app/pull/99))                                                                                                                   |
| 5D-3 | Info     | Small privacy-page and doc statements no longer exact (deleted-library leftovers, locked libraries deleted after 30 days, the replaced-key note's times, Photos' change counter, Deep check's size) | Fixed ([#96](https://github.com/shkriuss/shkriuss.app/pull/96), [#95](https://github.com/shkriuss/shkriuss.app/pull/95), [#99](https://github.com/shkriuss/shkriuss.app/pull/99)) |

#### E. Saving and syncing data

| ID   | Severity | What was wrong                                                                                              | What happened                                                                                                                                                     |
| ---- | -------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5E-1 | Medium   | An edit made with no connection was dated when it next synced, so an older edit could overwrite a newer one | Fixed ([#96](https://github.com/shkriuss/shkriuss.app/pull/96))                                                                                                   |
| 5E-2 | Medium   | "Turn off on this device" stayed on when the browser's storage was full, and said it was off                | Fixed ([#96](https://github.com/shkriuss/shkriuss.app/pull/96))                                                                                                   |
| 5E-3 | Low      | After a rollback the app opened empty with no explanation, and Restore then replaced the newer data         | Fixed ([#95](https://github.com/shkriuss/shkriuss.app/pull/95))                                                                                                   |
| 5E-4 | Low      | Photos: a deletion or save that stopped between its two steps left photo files on the device for good       | Fixed ([#99](https://github.com/shkriuss/shkriuss.app/pull/99))                                                                                                   |
| 5E-5 | Low      | IndexedDB: a connection the browser closed on its own was reused until the page was reloaded (suspicion)    | Fixed ([#95](https://github.com/shkriuss/shkriuss.app/pull/95))                                                                                                   |
| 5E-6 | Info     | A locked backup with an undecodable salt or IV got "Something went wrong" (same as 5A-4)                    | Fixed ([#95](https://github.com/shkriuss/shkriuss.app/pull/95))                                                                                                   |
| 5E-7 | Low      | If putting the old data back after a failed restore also failed, the old data was gone (suspicion)          | Fixed: each key is replaced in its place, and put back in an order that fits ([#95](https://github.com/shkriuss/shkriuss.app/pull/95))                            |
| 5E-8 | Info     | A plain backup didn't round-trip a value saved as a quoted JSON string (none exists today)                  | Fixed ([#95](https://github.com/shkriuss/shkriuss.app/pull/95))                                                                                                   |
| 5E-9 | Info     | Two tabs: a write in the few milliseconds of a sync round's save step could be lost (suspicion)             | Explained ([ADR 0010](../adr/0010-account-and-sync.md)): a known limit ([above](#whats-left-for-you-2)) ([#96](https://github.com/shkriuss/shkriuss.app/pull/96)) |

#### F1. Calendar, Tasks, Reminders, Habits, Water

| ID    | Severity | What was wrong                                                                                                   | What happened                                                   |
| ----- | -------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 5F1-1 | Low      | Tasks: a step ticked on another device was lost when any step was changed in a form open meanwhile               | Fixed ([#97](https://github.com/shkriuss/shkriuss.app/pull/97)) |
| 5F1-2 | Low      | Reminders: a text-only correction of an overdue reminder was refused once another device ticked it or put it off | Fixed ([#97](https://github.com/shkriuss/shkriuss.app/pull/97)) |
| 5F1-3 | Low      | Habits, Tasks, Reminders, Water: a reminder due in the minute the app was opened never rang in the open app      | Fixed ([#95](https://github.com/shkriuss/shkriuss.app/pull/95)) |
| 5F1-4 | Low      | Calendar, Tasks, Reminders, Habits: a long paste was cut without a word (same as 5G-4)                           | Fixed ([#97](https://github.com/shkriuss/shkriuss.app/pull/97)) |
| 5F1-5 | Low      | Reminders, Habits, Calendar: on an iPhone the box let in more than the rules accepted (counted differently)      | Fixed ([#97](https://github.com/shkriuss/shkriuss.app/pull/97)) |
| 5F1-6 | Info     | Habits: streaks were worked out day by day from the oldest check mark on every redraw                            | Fixed ([#97](https://github.com/shkriuss/shkriuss.app/pull/97)) |
| 5F1-7 | Info     | Habits, Tasks, Water: "today" lagged up to a minute after midnight while the page was on screen                  | Fixed ([#97](https://github.com/shkriuss/shkriuss.app/pull/97)) |

#### F2. Budget, Trades, Repairs, Meals, Tally

| ID    | Severity | What was wrong                                                                                                                      | What happened                                                                                     |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 5F2-1 | Medium   | Trades: a trade of 10 billion tokens or more could never be fully closed in parts, and "Delete a year" then kept its parts for ever | Fixed, for big trades with decimals too ([#98](https://github.com/shkriuss/shkriuss.app/pull/98)) |
| 5F2-2 | Low      | Budget: "Spent" and "Left" were rounded once at the end, so months in the trillions didn't match the categories                     | Fixed ([#98](https://github.com/shkriuss/shkriuss.app/pull/98))                                   |
| 5F2-3 | Low      | Budget, Trades, Repairs, Meals, Tally: on iPhones, text the box let in was refused on saving                                        | Fixed ([#98](https://github.com/shkriuss/shkriuss.app/pull/98))                                   |
| 5F2-4 | Low      | Repairs: hours were kept with any decimals but shown to two, so totals didn't match                                                 | Fixed ([#98](https://github.com/shkriuss/shkriuss.app/pull/98))                                   |
| 5F2-5 | Info     | A number too long to be one was called "not a number"                                                                               | Fixed ([#98](https://github.com/shkriuss/shkriuss.app/pull/98))                                   |
| 5F2-6 | Info     | Trades' spreadsheet wrote tiny prices with an exponent                                                                              | Fixed ([#98](https://github.com/shkriuss/shkriuss.app/pull/98))                                   |
| 5F2-7 | Info     | Tests: gaps that let 5F2-1, 5F2-2 and 5F2-4 through                                                                                 | Fixed ([#98](https://github.com/shkriuss/shkriuss.app/pull/98))                                   |

#### F3. Notes, Shelf, Grammar, Photos

| ID     | Severity | What was wrong                                                                                                                 | What happened                                                   |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| 5F3-1  | Low      | Shelf: saving an unchanged form brought back an item deleted on another device                                                 | Fixed ([#99](https://github.com/shkriuss/shkriuss.app/pull/99)) |
| 5F3-2  | Low      | Shelf: the "(second version)" name was cut inside an emoji, a flag or an accent                                                | Fixed ([#99](https://github.com/shkriuss/shkriuss.app/pull/99)) |
| 5F3-3  | Low      | Shelf: non-Latin links were saved and shown encoded, and a link that fit the box could be refused                              | Fixed ([#99](https://github.com/shkriuss/shkriuss.app/pull/99)) |
| 5F3-4  | Low      | Shelf: most Japanese web addresses stayed as "xn--…", though the README said Japanese is shown                                 | Fixed ([#99](https://github.com/shkriuss/shkriuss.app/pull/99)) |
| 5F3-5  | Low      | Grammar: "Check my text" stayed unusable after Deep check was removed or updated while starting                                | Fixed ([#99](https://github.com/shkriuss/shkriuss.app/pull/99)) |
| 5F3-6  | Low      | Photos: re-adding a photo this browser can't decode replaced its downloaded thumbnail with none                                | Fixed ([#99](https://github.com/shkriuss/shkriuss.app/pull/99)) |
| 5F3-7  | Low      | Notes: an old note whose text was cleared was deleted silently when it was left                                                | Fixed ([#99](https://github.com/shkriuss/shkriuss.app/pull/99)) |
| 5F3-8  | Low      | Notes: at 2,000 notes, typing in a note deleted elsewhere was silently never saved                                             | Fixed ([#99](https://github.com/shkriuss/shkriuss.app/pull/99)) |
| 5F3-9  | Info     | Grammar: nothing tested that Harper's positions match JavaScript's after an emoji                                              | Fixed ([#99](https://github.com/shkriuss/shkriuss.app/pull/99)) |
| 5F3-10 | Info     | Smaller points: Shelf's price parsing and search, Deep check's size and download message, HEIC across devices, odd photo names | Fixed ([#99](https://github.com/shkriuss/shkriuss.app/pull/99)) |

#### G. Accessibility

| ID   | Severity | What was wrong                                                                                                                                | What happened                                                                                                                                                                                                                                                                                                     |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5G-1 | Low      | A control hidden (not replaced) by a background redraw dropped keyboard focus to the top of the page                                          | Fixed ([#95](https://github.com/shkriuss/shkriuss.app/pull/95); Tasks' list editor in [#97](https://github.com/shkriuss/shkriuss.app/pull/97))                                                                                                                                                                    |
| 5G-2 | Low      | Photos: after "Unlock online storage" succeeded, focus was dropped to the top                                                                 | Fixed ([#99](https://github.com/shkriuss/shkriuss.app/pull/99))                                                                                                                                                                                                                                                   |
| 5G-3 | Low      | Confirmation dialogs didn't read out what they would delete (80 of 94 dialogs had no description)                                             | Fixed, in every app ([#95](https://github.com/shkriuss/shkriuss.app/pull/95), [#96](https://github.com/shkriuss/shkriuss.app/pull/96), [#97](https://github.com/shkriuss/shkriuss.app/pull/97), [#98](https://github.com/shkriuss/shkriuss.app/pull/98), [#99](https://github.com/shkriuss/shkriuss.app/pull/99)) |
| 5G-4 | Low      | Long pastes were still cut without a word in Tasks, Calendar, Habits, Reminders and Tally (same as 5F1-4)                                     | Fixed ([#97](https://github.com/shkriuss/shkriuss.app/pull/97); Tally in [#98](https://github.com/shkriuss/shkriuss.app/pull/98))                                                                                                                                                                                 |
| 5G-5 | Low      | Grammar: a checker that couldn't be downloaded was blamed on the browser, with no "Try again"                                                 | Fixed ([#99](https://github.com/shkriuss/shkriuss.app/pull/99))                                                                                                                                                                                                                                                   |
| 5G-6 | Low      | Grammar's Deep check said nothing to screen readers while it started and checked                                                              | Fixed ([#99](https://github.com/shkriuss/shkriuss.app/pull/99))                                                                                                                                                                                                                                                   |
| 5G-7 | Low      | Photos: a picture that couldn't be downloaded wasn't announced in the viewer                                                                  | Fixed ([#99](https://github.com/shkriuss/shkriuss.app/pull/99))                                                                                                                                                                                                                                                   |
| 5G-8 | Info     | Smaller points: Calendar's focus ring at midnight, repeated messages not read out, Grammar's "Clear the text?" wording, Repairs' button names | Fixed ([#97](https://github.com/shkriuss/shkriuss.app/pull/97), [#98](https://github.com/shkriuss/shkriuss.app/pull/98), [#99](https://github.com/shkriuss/shkriuss.app/pull/99))                                                                                                                                 |

#### H. CI and deploys

| ID   | Severity | What was wrong                                                                                        | What happened                                                                                                                                                                                                       |
| ---- | -------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5H-1 | Medium   | The lockfile checks could be bypassed by how the lockfile was written                                 | Fixed ([#94](https://github.com/shkriuss/shkriuss.app/pull/94))                                                                                                                                                     |
| 5H-2 | Low      | With a cold cache every deploy depended on Hugging Face, and the download wasn't bounded              | Fixed: a bounded download, and a workflow that keeps CI's caches warm; a second download source needs a copy you control ([above](#whats-left-for-you-2)) ([#94](https://github.com/shkriuss/shkriuss.app/pull/94)) |
| 5H-3 | Low      | The package-age check ran the pull request's own copy of the checker                                  | Fixed ([#94](https://github.com/shkriuss/shkriuss.app/pull/94))                                                                                                                                                     |
| 5H-4 | Info     | The action-pinning unit test wasn't strict on its own (zizmor is what enforces it)                    | Fixed ([#94](https://github.com/shkriuss/shkriuss.app/pull/94))                                                                                                                                                     |
| 5H-5 | Info     | Three doc sentences overstated or were stale ("exact files", ADR 0012's previews, the cache sentence) | Fixed ([#94](https://github.com/shkriuss/shkriuss.app/pull/94))                                                                                                                                                     |

#### I. Domain and Cloudflare

| ID   | Severity | What was wrong                                                                                                                                                         | What happened                                                                                                                                                                                                                 |
| ---- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5I-1 | Low      | Cloudflare served a `robots.txt` (its "Content Signals Policy") that the sites didn't have                                                                             | Fixed: every site ships its own, and the check after a deploy compares it ([above](#whats-left-for-you-2)) ([#95](https://github.com/shkriuss/shkriuss.app/pull/95), [#94](https://github.com/shkriuss/shkriuss.app/pull/94)) |
| 5I-2 | Info     | The two leftover Email Routing rules can be removed through the API (the docs said they can't be deleted)                                                              | Fixed: deployment.md says how ([#94](https://github.com/shkriuss/shkriuss.app/pull/94))                                                                                                                                       |
| 5I-3 | Info     | Merging didn't require a branch to be up to date with `main`                                                                                                           | Explained ([above](#whats-left-for-you-2)): optional, with its cost, in deployment.md ([#94](https://github.com/shkriuss/shkriuss.app/pull/94))                                                                               |
| 5I-4 | Info     | Small hardening steps and notes: zone hold, secret-scanning extras, the account's other domains, CAA for email certificates, SSL Labs, stale `checklists` certificates | Explained ([above](#whats-left-for-you-2)): in deployment.md, for you to turn on ([#94](https://github.com/shkriuss/shkriuss.app/pull/94))                                                                                    |

#### J. Architecture and tests

| ID    | Severity | What was wrong                                                                                                                                        | What happened                                                                                                                                                                                                                                                                                                                        |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5J-1  | Low      | Every sync round re-read and re-fingerprinted every item of every synced store on the main thread                                                     | Explained ([above](#whats-left-for-you-2)): left as is ([#96](https://github.com/shkriuss/shkriuss.app/pull/96))                                                                                                                                                                                                                     |
| 5J-2  | Low      | The JavaScript budget was nearly used up again (Tasks 375 bytes under, Budget 829)                                                                    | Fixed: Tasks' form, Budget's forms, the backup code and sync's connect code load after the page ([#97](https://github.com/shkriuss/shkriuss.app/pull/97), [#98](https://github.com/shkriuss/shkriuss.app/pull/98), [#95](https://github.com/shkriuss/shkriuss.app/pull/95), [#96](https://github.com/shkriuss/shkriuss.app/pull/96)) |
| 5J-3  | Low      | PLAN.md's line counts were wrong when written; Tasks' page script was one 880-line closure                                                            | Fixed ([#97](https://github.com/shkriuss/shkriuss.app/pull/97); PLAN.md here)                                                                                                                                                                                                                                                        |
| 5J-4  | Low      | ADR 0017's body still described previews and "about two more apps"                                                                                    | Fixed ([#96](https://github.com/shkriuss/shkriuss.app/pull/96))                                                                                                                                                                                                                                                                      |
| 5J-5  | Info     | ADR 0007 didn't record the ES2022 check (audit 4 J-3)                                                                                                 | Fixed ([#94](https://github.com/shkriuss/shkriuss.app/pull/94))                                                                                                                                                                                                                                                                      |
| 5J-6  | Info     | adding-an-app.md's "Wait about a minute" for the New app workflow was optimistic                                                                      | Fixed ([#94](https://github.com/shkriuss/shkriuss.app/pull/94))                                                                                                                                                                                                                                                                      |
| 5J-7  | Info     | The brief's "largest files" claim missed the sync client; the largest test file is 2,562 lines                                                        | Fixed (here)                                                                                                                                                                                                                                                                                                                         |
| 5J-8  | Info     | What a newcomer needed that no doc mentioned (the in-memory Worker fakes, `ALLOW_LOCAL_ENDPOINTS`, running one test file or one site's browser tests) | Fixed ([#94](https://github.com/shkriuss/shkriuss.app/pull/94))                                                                                                                                                                                                                                                                      |
| 5J-9  | Info     | The "every typed word is in the folded text" search was written five times                                                                            | Explained ([above](#whats-left-for-you-2)): planned, with the other copied helpers ([PLAN.md](../PLAN.md))                                                                                                                                                                                                                           |
| 5J-10 | Info     | Three keep-focus tests picked sites from plain tables, so a new app was skipped there silently                                                        | Fixed ([#95](https://github.com/shkriuss/shkriuss.app/pull/95))                                                                                                                                                                                                                                                                      |

#### Z. Anything else

| ID   | Severity | What was wrong                                                                                                  | What happened                                                                                                                                          |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5Z-1 | Medium   | A missing file under `/_astro/` was served as "not found" with a one-year `immutable` cache header              | Fixed ([#95](https://github.com/shkriuss/shkriuss.app/pull/95))                                                                                        |
| 5Z-2 | Low      | Downloads freed their file after one second, likely too soon for an iPhone's download prompt                    | Fixed ([#95](https://github.com/shkriuss/shkriuss.app/pull/95); the hub's wording in [#96](https://github.com/shkriuss/shkriuss.app/pull/96))          |
| 5Z-3 | Low      | The Deep check licence file named Automattic as GECToR's copyright holder                                       | Fixed ([#99](https://github.com/shkriuss/shkriuss.app/pull/99))                                                                                        |
| 5Z-4 | Info     | Gaps in the "nothing from other websites" guards: resource hints, loose `allowConsole`, no precache size budget | Fixed ([#94](https://github.com/shkriuss/shkriuss.app/pull/94); the hub's console messages in [#96](https://github.com/shkriuss/shkriuss.app/pull/96)) |
| 5Z-5 | Info     | Four known advisories in a build-only dependency (`fast-uri`), below CI's gate                                  | Fixed ([#94](https://github.com/shkriuss/shkriuss.app/pull/94))                                                                                        |
