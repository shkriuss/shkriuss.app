# Trades

Your trading journal: log your trades and see what works. Lives at
<https://trades.shkriuss.app>.

- `src/lib/trades.ts`: the rules as plain functions, with unit tests next to
  them (`trades.test.ts`).
  - A trade (`shkriuss:trades`) is a symbol, long or short, the day and
    price it was entered, how many, and, once closed, the day and price it
    was exited. Optional: a stop loss, fees (in total), a setup name
    ("Breakout", suggested from the ones used before) and notes. While both
    exit fields are empty, the trade is open.
  - Its result is worked out, never saved: the profit or loss after fees
    (`profit`), as a percentage of what was put in (`returnPercent`), and
    in R, times the risk to the stop loss (`rMultiple`).
  - Results for a period (all time, this or last month, this year; by the
    day trades were exited): net result, win rate, profit factor (won for
    each 1 lost), average win and loss, best and worst trade, average R
    (`stats`), and the same by setup and by month.
  - Closing part of a trade (`readClose`): the close form's "Quantity
    closed" is the whole trade unless it's changed. Less than all of it
    splits the trade in two: the part closed becomes a trade of its own
    (a new id, that quantity, the exit, and the fees typed in), and the rest
    stays open (the trade's own id, the same entry and stop loss, and no
    fees, so none are counted twice). Nothing about how trades are saved
    changed: they're two ordinary trades.
  - "Download as a spreadsheet (CSV)" saves every trade with its result.
    Text that a spreadsheet could read as a formula starts with `'`.
  - Trades keeps up to 3,500 trades, open and closed (`LIMITS.trades`).
    Why not more: each trade is saved on the device, where a browser keeps
    about 5 MB for each site, and with sync on, sync keeps records of its
    own there too. The test "has room for every trade" fills Trades up
    with realistic trades (notes of a few sentences) and checks that it all
    still fits, on an iPhone too, and in the copy that syncs. If a change
    makes trades bigger, that test fails, and the limit has to come down.
  - To make room, "Delete a year…" (next to the spreadsheet download)
    deletes the trades closed in one year, by the day they were closed
    (`closedYears`, `removeClosedYear`). Open trades always stay. It says
    how many that is, and offers the spreadsheet first. With sync on, they're
    deleted on the other devices too. Once more than 90% of the 3,500 are
    used, a note at the top says how many are left and points to it
    (`roomNote`).
  - The currency (`shkriuss:trades-settings`) is only for showing amounts:
    nothing is converted. It's saved only once changed (US dollars until
    then), so a new device has nothing to win over another's when they
    first sync.
- `src/scripts/trades.ts`: connects the page to those rules. Open trades are
  listed first, with "Close" to fill in the exit (all of the trade, or part
  of it). Closed trades can be searched by symbol, setup or notes, 50 at a
  time.
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  `<template>`s hold the markup for a trade and a line of "By setup" or "By
  month"; the trade form and "Delete a year" are dialogs.
- `src/worker.ts`: runs the shared sync server
  ([ADR 0010](../../docs/adr/0010-account-and-sync.md)). The newest change
  to each trade wins: one changed on two devices at once isn't kept twice,
  which would count it twice in the results.
- `e2e/`: browser tests (`helpers.ts` is shared by them). The shared
  accessibility, security, offline and sync checks in `tests/e2e/` run too.

Its name, description, icon and colour are in
[`packages/registry/apps.json`](../../packages/registry/apps.json).
