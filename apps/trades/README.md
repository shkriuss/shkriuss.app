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
    closed" is all that's still open unless it's changed. Less than all of
    it adds the part closed as a trade of its own (a new id, that quantity,
    the exit, and the fees typed in) that names the trade it was closed off
    (`parent`). That trade keeps its quantity (what was bought) and its
    fees: what's still open of it is its quantity less its parts'
    (`openQuantity`), and its fees count with its first part (`openFees`),
    so none are counted twice. Closing the rest adds a last part; the trade
    then isn't open, and isn't listed (its parts are the closed trades).
    Since closing part never changes the trade itself, a change made to it
    on another device at the same time (a new stop loss, say) can't bring
    back what was closed, and parts closed on two devices both count. If
    they close more than was bought (two devices each closing the rest),
    the trade and its parts say so (`overClosed`), until the close that's
    wrong is deleted. Deleting a part counts what it closed as open again;
    deleting a trade leaves its parts as trades of their own.
  - Parts came in data version 2 (`TRADES_VERSION`). What version 1 saved
    reads the same (`migrateTrades`): its parts were trades of their own,
    next to the rest, made smaller. A device still on version 1 waits for
    its update before it syncs, instead of counting parts twice.
  - "Download as a spreadsheet (CSV)" saves every trade with its result
    (each part of a trade, and what's still open of it). Text that a
    spreadsheet could read as a formula starts with `'`.
  - Trades keeps up to 3,500 trades, open and closed (`LIMITS.trades`).
    Why not more: each trade is saved on the device, where a browser keeps
    about 5 MB for each site, and with sync on, sync keeps records of its
    own there too. The test "has room for every trade" fills Trades up
    with realistic trades (notes of a few sentences) and checks that it all
    still fits, on an iPhone too, and in the copy that syncs. If a change
    makes trades bigger, that test fails, and the limit has to come down.
  - To make room, "Delete a year…" (next to the spreadsheet download)
    deletes the trades closed in one year, by the day they were closed
    (`closedYears`, `removeClosedYear`). Open trades always stay, with as
    much still open as before (a trade whose parts go keeps less of its
    quantity, and goes too once nothing is left of it). It says how many
    that is, and offers the spreadsheet first. With sync on, they're
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
  which would count it twice in the results. Parts are trades of their
  own, so closing part of a trade is never undone by a change to it.
- `e2e/`: browser tests (`helpers.ts` is shared by them). The shared
  accessibility, security, offline and sync checks in `tests/e2e/` run too.

Its name, description, icon and colour are in
[`packages/registry/apps.json`](../../packages/registry/apps.json).
