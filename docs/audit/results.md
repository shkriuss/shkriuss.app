# Audit results, October 2026

This is what the first full audit found, and what happened to each finding.
The brief every auditor followed is in [README.md](README.md), and the
prompts for each AI tool are in [prompts.md](prompts.md).

The repository is public, so anything still open that could be used against
anyone is listed here without its details until it's fixed (see
[SECURITY.md](../../SECURITY.md)).

## How it was done

- **Who:** Claude Code checked every area in the brief, one at a time, with a
  separate review for each area. Other AI tools can repeat the audit with the
  same prompts, and their reports are compared against this list.
- **What:** the code in this repository, the GitHub settings and workflows,
  and the live sites: the domain, its DNS records, its certificates, the
  security headers and the Cloudflare settings that can be seen from outside.
- **Evidence:** each finding came with the code that shows it, or a test or
  command that proves it. Each fix comes with a test that fails without it,
  where one can be written.
- **Fixes:** in [pull request #50](https://github.com/shkriuss/shkriuss.app/pull/50).

## Totals

| Severity | Found | Fixed | Partly fixed | Your setting | Your choice | Later | Explained or accepted |
| -------- | ----- | ----- | ------------ | ------------ | ----------- | ----- | --------------------- |
| High     | 14    | 14    | –            | –            | –           | –     | –                     |
| Medium   | 34    | 34    | –            | –            | –           | –     | –                     |
| Low      | 90    | 79    | 1            | –            | –           | 8     | 2                     |
| Info     | 24    | 12    | 1            | –            | 1           | 7     | 3                     |
| **All**  | 162   | 139   | 2            | –            | 1           | 15    | 5                     |

"Your setting" means a change in Cloudflare or GitHub that only the owner can
make, listed in [deployment.md](../deployment.md). "Later" means a real but
small problem, or a bigger change, that's planned rather than done now.

## What's left for the owner

**Settings:** all done (23 October 2026), step by step in
[deployment.md](../deployment.md). The ones that can be seen from outside
were checked: the email and certificate records, the limit on requests to
the servers, the deploy's token and storage code, previews waiting for
approval, and pages that nothing rewrites.

**Choices** (the default is already in place; say if you want the other):

- **F1-10:** a task due today at a set time becomes "Overdue" only the next
  day. The other choice is as soon as its time passes.
- **I-6:** old builds stay at their "version preview" addresses, which are
  hard to guess and show only code that was public anyway. The other choice
  is hiding them, which also puts pull request previews behind a sign-in.
- **Z-11:** the repository has no licence file, so anyone may read the code
  but not reuse it. The other choice is adding one, like MIT.

## Planned for later

Real, but small or rare, or a bigger change best done on its own. None of them can leak or lose anyone’s data.

- **A-8** (Info) The ADRs don't say what the servers can roll back, withhold or drop. _Later: write down what a server could roll back or withhold._
- **E-12** (Low) The list's order is one value for the whole list, so adding or deleting an item on one device undoes a reorder made on another. _Later: each item needs its own place in the order._
- **F1-4** (Low) Importing a repeating event can drop its last time when the two time zones change clocks on different dates. _Later: rare, needs both time zones in the import._
- **F1-5** (Low) Repeating events imported from another time zone are an hour off for part of the year, without a word. _Later: rare, needs both time zones in the import._
- **F2-3** (Low) Meals' shopping ticks and hand-added items don't show on a synced device whose week starts on another day. _Later: a shared "week starts on" setting._
- **F2-8** (Low) The item limits are reachable in normal use, and there's no way to clear old items except one at a time. _Later: higher limits, and a way to clear a whole period._
- **F2-10** (Info) Refunds in a category and partial closes can't be recorded. _Later: app features._
- **G-14** (Info) Smaller points: Grammar’s fixes clear undo, double announcements, three wordings for "Couldn’t save". _Partly fixed (one read-out per message, one wording for "Couldn’t save"); keeping Grammar’s undo history is later._
- **H-13** (Info) Some CI tools are pinned by hand and Dependabot never updates them. _Later: let Dependabot update the hand-pinned tools._
- **J-6** (Low) The "notifications while open" code is copied into six apps, and five of them never test the iPhone and blocked cases. _Later: one shared module for reminders while open._
- **J-7** (Low) Three files of about 1,000 lines, each mostly one closure, are hard to change safely. _Later: split the three biggest files._
- **J-8** (Low) Small helpers are copied between apps and have drifted, including a slow comparator and a misleading "Couldn't save". _Partly fixed (the comparator, and one wording for "Couldn’t save"); the rest later._
- **J-14** (Info) Browser tests always start all 15 servers, and CI time grows about a minute per app toward a 30-minute limit. _Later: run only the sites a change touches._
- **J-15** (Info) Storage that's synchronous and `localStorage`-only will be hard to grow, and app limits already exceed what fits. _Later: storage that can grow, if needed._
- **J-16** (Info) Browser test helpers repeat storage formats and photo helpers by hand. _Later: shared test helpers._
- **J-17** (Info) Flaky browser tests are retried in CI and never reported. _Later: list flaky tests in the job summary._
- **Z-10** (Low) Right-to-left text shows its full stop or "!" at the wrong end. _Later: show right-to-left text the right way round (dir="auto")._

## Every finding

Severity is the auditor’s: **High** could lose or leak data or cost money; **Medium** breaks something people rely on; **Low** is a smaller bug; **Info** is a note.

### A. Account and keys

| ID  | Severity | What was wrong                                                                                                                                        | What happened                                                                            |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A-1 | High     | The lost device can start the moved copy again, so "Replace the account key" doesn't shut it out                                                      | Fixed                                                                                    |
| A-2 | Medium   | The storage code's "10 wrong tries an hour" is per library, and anyone can make new libraries                                                         | Fixed (then changed again by Z-1)                                                        |
| A-3 | Medium   | After the key is replaced, the old key can take over the online photo library before the person's device moves it                                     | Fixed                                                                                    |
| A-4 | Low      | The 40-bit account code can be matched by brute force, so it doesn't catch a targeted fake link                                                       | Explained (ADR 0010): the code spots mistakes, the QR code and link carry the real check |
| A-5 | Low      | A device-link QR code used by someone else looks like a normal success, so it isn't noticed                                                           | Fixed                                                                                    |
| A-6 | Low      | After "Replace the account key", the old key keeps full access to each app until that app is turned on again, but the page says it "stops it syncing" | Fixed                                                                                    |
| A-7 | Info     | Bearer tokens can be replayed by anyone who sees Worker requests; the status token alone can lock an account out for good                             | Accepted: only Cloudflare, which runs the servers, sees requests                         |
| A-8 | Info     | The ADRs don't say what the servers can roll back, withhold or drop                                                                                   | Later: write down what a server could roll back or withhold                              |

### B. Servers and the bill

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

### C. Pages and the browser

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

### D. Privacy and what the pages promise

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

### E. Saving and syncing data

| ID   | Severity | What was wrong                                                                                                                                                                                   | What happened                                     |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| E-1  | High     | Rolling back an app after a data version change wipes people's data, and with sync on it deletes it on every device                                                                              | Fixed                                             |
| E-2  | High     | A sync that is already running undoes "Delete all data" and "Turn off"; after "Delete all data" the reload deletes everything on every device                                                    | Fixed                                             |
| E-3  | High     | Changes from other devices are saved, but the page isn't told until the upload succeeds; an edit in between brings back deleted items and deletes new ones everywhere                            | Fixed                                             |
| E-4  | High     | The first sync after a data version change marks every item as just edited, so the stalest device overwrites everyone else's edits and brings back deletions                                     | Fixed                                             |
| E-5  | High     | Photos: after the account key is replaced, a device that only has the new key can replace the record of the real online library, cutting everyone off from it while the lost device keeps access | Fixed (one rare case left, in ADR 0016)           |
| E-6  | Medium   | A device whose clock is behind silently loses its own edits and deletions, with no conflict at all                                                                                               | Fixed                                             |
| E-7  | Medium   | Deleted items come back after 180 days: from a device that hasn't synced in that time, after sync was off that long, or because of a clock far ahead                                             | Fixed                                             |
| E-8  | Medium   | "Keep both" stops protecting an edit after an upload fails, or after an edit made while sync was off                                                                                             | Fixed                                             |
| E-9  | Medium   | Safari's 7-day deletion and private windows: nobody is told, and only apps with photos ask the browser to keep their data                                                                        | Fixed                                             |
| E-10 | Medium   | Photos' "Free up space" trusts this device's old note that photos are online                                                                                                                     | Fixed                                             |
| E-11 | Low      | A calendar file with `UID:__proto__` stops sync on that device for good                                                                                                                          | Fixed                                             |
| E-12 | Low      | The list's order is one value for the whole list, so adding or deleting an item on one device undoes a reorder made on another                                                                   | Later: each item needs its own place in the order |

### F1. Calendar, Tasks, Reminders, Habits, Water

| ID    | Severity | What was wrong                                                                                               | What happened                                                 |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| F1-1  | Medium   | Monthly and yearly tasks drift to the 28th for good after one short month                                    | Fixed                                                         |
| F1-2  | Medium   | In fluid ounces, drinking exactly the goal in bottles doesn't reach it ("0 fl oz to go")                     | Fixed                                                         |
| F1-3  | Low      | Calendar won't save or import a daily event that goes past midnight                                          | Fixed                                                         |
| F1-4  | Low      | Importing a repeating event can drop its last time when the two time zones change clocks on different dates  | Later: rare, needs both time zones in the import              |
| F1-5  | Low      | Repeating events imported from another time zone are an hour off for part of the year, without a word        | Later: rare, needs both time zones in the import              |
| F1-6  | Low      | In a daylight-saving gap, reminders west of UTC go off an hour early, the evening before at midnight changes | Fixed                                                         |
| F1-7  | Low      | After travelling, notifications keep the old time zone until the app is reloaded or something changes        | Fixed                                                         |
| F1-8  | Low      | Ticking off a repeating task dated in the year 9999 empties the whole task list                              | Fixed                                                         |
| F1-9  | Low      | Calendar's README says nothing is ever sent and there's no push server                                       | Fixed (as D-15)                                               |
| F1-10 | Info     | A task due today at a time isn't "Overdue" once that time has passed                                         | Your choice: mark timed tasks overdue once their time passes? |

### F2. Budget, Trades, Repairs, Meals, Tally

| ID    | Severity | What was wrong                                                                                            | What happened                                           |
| ----- | -------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| F2-1  | High     | An amount that rounds to 0 makes Budget lose every entry (or every category), on every synced device      | Fixed                                                   |
| F2-2  | Medium   | A comma typed in a money or hours field is dropped or misread without a word ("12,50" is saved as 1250)   | Fixed                                                   |
| F2-3  | Low      | Meals' shopping ticks and hand-added items don't show on a synced device whose week starts on another day | Later: a shared "week starts on" setting                |
| F2-4  | Low      | Trades' setups are case- and space-sensitive, so one setup splits into several in "By setup"              | Fixed                                                   |
| F2-5  | Low      | Trades accepts any size of number, so results can show Infinity or NaN, and very small prices show as 0   | Fixed                                                   |
| F2-6  | Low      | Trades rounds the win rate to whole percent: 1 loss in 250 shows "100%"                                   | Fixed                                                   |
| F2-7  | Low      | A Repairs day cut by "Show more" shows a day total for only part of the day                               | Fixed                                                   |
| F2-8  | Low      | The item limits are reachable in normal use, and there's no way to clear old items except one at a time   | Later: higher limits, and a way to clear a whole period |
| F2-9  | Info     | Tally keeps two counters, not the sum, when both devices counted                                          | By design (both devices counted)                        |
| F2-10 | Info     | Refunds in a category and partial closes can't be recorded                                                | Later: app features                                     |
| F2-11 | Info     | Tests: gaps that let F2-1 to F2-3 through                                                                 | Fixed (tests added with each fix)                       |

### F3. Notes, Shelf, Grammar, Photos

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

### G. Accessibility

| ID   | Severity | What was wrong                                                                                        | What happened                                                                                                     |
| ---- | -------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| G-1  | Medium   | When saving fails, most people aren’t told, and some apps go on as if it was saved                    | Fixed                                                                                                             |
| G-2  | Medium   | "Delete all data" deletes nothing while the network hangs, and only says "Deleting…"                  | Fixed                                                                                                             |
| G-3  | Medium   | An error shown after pressing Enter or "Done" in the field isn’t read out                             | Fixed                                                                                                             |
| G-4  | Medium   | Two one-tap buttons destroy data with no confirmation and no undo                                     | Fixed                                                                                                             |
| G-5  | Low      | Habits’ "last 7 days" shows a tick on every day, done or not                                          | Fixed                                                                                                             |
| G-6  | Low      | In Windows contrast themes, selected and "on" states disappear                                        | Fixed                                                                                                             |
| G-7  | Low      | Buttons that are waiting get disabled, which throws keyboard and screen reader focus back to the page | Fixed                                                                                                             |
| G-8  | Low      | While the network hangs, sync shows "Syncing…" for ever, and "Turn on sync" goes silent               | Fixed                                                                                                             |
| G-9  | Low      | With sync on, the sync status is read out again every minute                                          | Fixed                                                                                                             |
| G-10 | Low      | The Restore dialog opens with "Restore" focused, the button that replaces everything                  | Fixed                                                                                                             |
| G-11 | Low      | With text at 200%, the theme switch doesn’t wrap, so every page scrolls sideways                      | Fixed                                                                                                             |
| G-12 | Low      | Some tap targets are smaller than the project’s own 44 px rule                                        | Fixed (the footer links); Calendar's days at 320px are a written exception                                        |
| G-13 | Low      | text-size-adjust: none may turn off Android’s own text-size setting                                   | Fixed: changed to the safer 100% (not tried on an Android phone)                                                  |
| G-14 | Info     | Smaller points: Grammar’s fixes clear undo, double announcements, three wordings for "Couldn’t save"  | Partly fixed (one read-out per message, one wording for "Couldn’t save"); keeping Grammar’s undo history is later |

### H. CI and deploys

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
| H-13 | Info     | Some CI tools are pinned by hand and Dependabot never updates them                                                                       | Later: let Dependabot update the hand-pinned tools                          |

### I. Domain and Cloudflare

| ID   | Severity | What was wrong                                                                                                        | What happened                                                         |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| I-1  | High     | Auto-renew is off, so the domain won't renew itself                                                                   | Fixed (your setting)                                                  |
| I-2  | Low      | No SPF, DMARC or null MX records say the domain sends no email, and two email forwarding rules sit unused             | Fixed (your setting; checked on 23 October)                           |
| I-3  | Low      | Cloudflare features can rewrite live pages, and nothing checks the live HTML                                          | Fixed (the features are off, and the live check spots a changed page) |
| I-4  | Low      | The privacy page says Cloudflare data "is not collected", but Cloudflare keeps security events and traffic statistics | Fixed                                                                 |
| I-5  | Low      | No CAA record, so any public CA may issue certificates for the domain                                                 | Fixed (your setting; checked on 23 October)                           |
| I-6  | Low      | 36 old builds stay public indefinitely at "version preview" addresses                                                 | Explained (deployment.md); hiding them is your choice                 |
| I-7  | Low      | No `security.txt` on any site                                                                                         | Fixed                                                                 |
| I-8  | Info     | Nothing at the edge limits requests to `/api/*`, and all apps share the free daily limits                             | Fixed (your setting; checked on 23 October)                           |
| I-9  | Info     | GitHub repository settings to tidy                                                                                    | Fixed (your setting)                                                  |
| I-10 | Info     | Small Cloudflare account settings to add                                                                              | Fixed (your setting)                                                  |
| I-11 | Info     | Previews get the production storage code                                                                              | Fixed                                                                 |

### J. Architecture and tests

| ID   | Severity | What was wrong                                                                                                               | What happened                                                                      |
| ---- | -------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| J-1  | Medium   | Long lists are rebuilt in full on every change, which freezes Tasks (and likely Shelf and Notes) well below their own limits | Fixed                                                                              |
| J-2  | Medium   | Every colour depends on CSS `light-dark()` with no fallback, and no browser baseline is written down or tested               | Fixed                                                                              |
| J-3  | Medium   | Photos reloads, checks and re-sorts the whole library every time the window gets focus                                       | Fixed                                                                              |
| J-4  | Medium   | The JS size budget doesn't count shared chunks, so two pages are over budget while `check:dist` passes                       | Fixed                                                                              |
| J-5  | Medium   | Browser tests don't check the second device for errors, CSP violations or outside requests                                   | Fixed                                                                              |
| J-6  | Low      | The "notifications while open" code is copied into six apps, and five of them never test the iPhone and blocked cases        | Later: one shared module for reminders while open                                  |
| J-7  | Low      | Three files of about 1,000 lines, each mostly one closure, are hard to change safely                                         | Later: split the three biggest files                                               |
| J-8  | Low      | Small helpers are copied between apps and have drifted, including a slow comparator and a misleading "Couldn't save"         | Partly fixed (the comparator, and one wording for "Couldn’t save"); the rest later |
| J-9  | Low      | Several docs no longer describe the system                                                                                   | Fixed                                                                              |
| J-10 | Low      | The app template's test bypasses the shared browser checks                                                                   | Fixed                                                                              |
| J-11 | Low      | Scheduled notification delivery (the push Durable Object's alarm) has no test                                                | Fixed                                                                              |
| J-12 | Low      | The files database can't be upgraded safely, and a database without its table is never repaired                              | Fixed                                                                              |
| J-13 | Low      | Local browser tests use fixed ports and reuse whatever server is already listening                                           | Fixed                                                                              |
| J-14 | Info     | Browser tests always start all 15 servers, and CI time grows about a minute per app toward a 30-minute limit                 | Later: run only the sites a change touches                                         |
| J-15 | Info     | Storage that's synchronous and `localStorage`-only will be hard to grow, and app limits already exceed what fits             | Later: storage that can grow, if needed                                            |
| J-16 | Info     | Browser test helpers repeat storage formats and photo helpers by hand                                                        | Later: shared test helpers                                                         |
| J-17 | Info     | Flaky browser tests are retried in CI and never reported                                                                     | Later: list flaky tests in the job summary                                         |
| J-18 | Info     | The cache test for pages would pass for a page cached for a year                                                             | Fixed                                                                              |

### Z. Anything else

| ID   | Severity | What was wrong                                                                                                   | What happened                                                   |
| ---- | -------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Z-1  | Medium   | Anyone can lock everyone out of the online photo library with 20 requests an hour                                | Fixed                                                           |
| Z-2  | Medium   | After a deploy, a slow connection can leave an app that opens empty when offline                                 | Fixed                                                           |
| Z-3  | Medium   | Every build and every deploy needs a 361 MB download from one Hugging Face account                               | Fixed                                                           |
| Z-4  | Low      | A new app made with `pnpm new-app` or the "New app" workflow tells the privacy page it stores nothing            | Fixed                                                           |
| Z-5  | Low      | The template's browser test skips the shared checks (console errors and requests to other sites)                 | Fixed                                                           |
| Z-6  | Low      | The JavaScript size budget doesn't count imported files; Calendar and Tasks are over it                          | Fixed                                                           |
| Z-7  | Low      | The QR code encoder is a translation of an MIT-licensed library, without its copyright notice                    | Fixed                                                           |
| Z-8  | Low      | Deep check's licence file calls RoBERTa's files Apache 2.0 and leaves out their MIT notice                       | Fixed                                                           |
| Z-9  | Low      | On a phone set to another language, sentences mix English with that language, and the page says it's all English | Fixed                                                           |
| Z-10 | Low      | Right-to-left text shows its full stop or "!" at the wrong end                                                   | Later: show right-to-left text the right way round (dir="auto") |
| Z-11 | Info     | Smaller points                                                                                                   | Fixed (the licence link); a LICENSE file is your choice         |
| Z-12 | Info     | The threat model has no goal for keeping things working                                                          | Fixed                                                           |
