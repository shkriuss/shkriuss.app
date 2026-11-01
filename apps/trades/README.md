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
    (`stats`), and the same by setup and by month. Choosing a period reads
    out how many trades were closed in it and their net result
    (`periodSummary`). The form takes prices
    and quantities up to a trillion (`LIMITS.number`); a trade restored from
    a backup or synced can be bigger (older data must stay readable), and a
    result too big to work out shows as "—" (`formatResult`). Quantities and
    results are rounded to 8 decimals by their digits once they're big
    (`tidy`), and a difference too small for a number of that size to tell
    apart counts as none (`nearly`), so a trade of billions of tokens, or
    of a hundred million with decimals, closed in parts leaves nothing
    "still open" (audit 5 F2-1).
  - Numbers are read the way the person's language writes them
    (`parseDecimal`), but one comma or point before exactly three digits
    ("149,853", "1.500") could be either sign: the form asks which number
    is meant. An iPhone's number keypad offers the decimal sign of the
    phone's region, which may not be the browser language's, and a price
    can have three decimals (audit 4 F2-10). Fees are asked about the same
    way, as Budget's amounts are (F2-12).
  - Closing part of a trade (`readClose`): the close form's "Quantity
    closed" is all that's still open unless it's changed. Less than all of
    it adds the part closed as a trade of its own (a new id, that quantity,
    the exit, and the fees typed in) that names the trade it was closed off
    (`parent`). That trade keeps its quantity (what was bought) and its
    fees: what's still open of it is its quantity less its parts'
    (`openQuantity`), and its fees count with its first part (`openFees`),
    so none are counted twice. Closing the rest from the trade's own form
    ("Change trade", with an exit filled in), which shows the trade's fees,
    counts them the same way: left as they are, the last part takes only
    the fees not counted yet; fees typed there are the last part's (audit 6
    F2-1, where they counted twice). A part stays closed while its trade is
    there: to open it again, delete it, and its quantity is open in its
    trade again. (One opened again and closed in parts of its own made
    "Delete a year" count what they closed as open again, audit 4 F2-6;
    parts of parts made before that are kept by "Delete a year".) A part
    whose trade was deleted (with "Delete a year", when its other parts
    went) is a trade of its own, and can be opened again like one. Closing the rest adds a last part;
    the trade then isn't open, and isn't listed (its parts are the closed
    trades).
    Since closing part never changes the trade itself, a change made to it
    on another device at the same time (a new stop loss, say) can't bring
    back what was closed, and parts closed on two devices both count. If
    they close more than was bought (two devices each closing the rest),
    the trade and its parts say so (`overClosed`), until the close that's
    wrong is deleted. Deleting a part counts what it closed as open again;
    deleting a trade leaves its parts as trades of their own.
  - Each part counts as a closed trade of its own in the results (the
    number of closed trades, the win rate, the averages, by setup and by
    month), as it has its own exit and result: one position closed in three
    parts is three closed trades. The page says so under the results when
    the trades shown have parts. A part takes the trade's symbol, entry
    price, side and setup as they were when it was closed; putting one of
    those right on the trade later changes its parts too, in the same save,
    unless a part was given its own (`followingParts`), so their results
    follow. With a new entry price or side, a part takes the trade's stop
    loss too if it had the trade's, and a stop loss left on the wrong side
    of a part's entry is taken off it, as its R would mean nothing (audit 6
    F2-4). A stop loss moved later on its own, or the trade's notes, stay
    the trade's own.
  - Parts came in data version 2 (`TRADES_VERSION`). What version 1 saved
    reads the same (`migrateTrades`): its parts were trades of their own,
    next to the rest, made smaller. A device still on version 1 waits for
    its update before it syncs, instead of counting parts twice.
  - "Download as a spreadsheet (CSV)" saves every trade with its result
    (each part of a trade, and what's still open of it). A trade closed
    more than it was bought has a row with what it bought, its notes
    starting with what the page says of it (audit 6 F2-4). Text that a
    spreadsheet could read as a formula starts with `'`. The file starts
    with a byte-order mark, so Excel shows text beyond plain English
    letters (Georgian, "’") as typed. In a language that writes decimals
    with a comma, cells are split by ";" and numbers written "1,085", as
    spreadsheets there read them (audit 4 F2-9).
  - Trades keeps up to 3,500 trades, open and closed (`LIMITS.trades`).
    Why not more: each trade is saved on the device, where a browser keeps
    about 5 MB for each site, and with sync on, sync keeps records of its
    own there too. The test "has room for every trade" fills Trades up
    with realistic trades (notes of a few sentences) and checks that it all
    still fits, on an iPhone too, and in the copy that syncs. If a change
    makes trades bigger, that test fails, and the limit has to come down.
    Only a new trade, or closing part of one (a trade of its own), is
    refused once Trades is full: with more than that (two devices' trades
    put together when sync is turned on), trades can still be changed and
    closed.
  - To make room, "Delete a year…" (next to the spreadsheet download)
    deletes the trades closed in one year, by the day they were closed
    (`closedYears`, `removeClosedYear`). It never changes a trade, so a
    change to one on a device that hadn't synced can't bring back what was
    deleted. Open trades always stay, and so do the parts of them closed
    that year, which say how much is still open: they go once all of their
    trade is closed (and then the trade goes with them; its parts from other
    years stay, as trades of their own). It says how many that is, and what
    stays, and offers the spreadsheet first. With sync on, they're
    deleted on the other devices too. If that year changes on another
    device or tab while the dialog is open, it closes and says so, rather
    than deleting another year or more than it said. Once more than 90% of
    the 3,500 are used, a note at the top says how many are left and points
    to it (`roomNote`).
  - The currency (`shkriuss:trades-settings`) is only for showing amounts:
    nothing is converted. It's saved only once changed (US dollars until
    then), so a new device has nothing to win over another's when they
    first sync.
  - Text limits (the symbol, setup and notes) count characters as people
    see them, as an iPhone's text boxes count what fits in them: a flag or
    a family emoji is one, so what a full box holds is never refused on
    saving (`cutToLength`, audit 5 F2-3).
- `src/scripts/trades.ts`: connects the page to those rules. Open trades are
  listed first, with "Close" to fill in the exit (all of the trade, or part
  of it). Closed trades can be searched by symbol, setup or notes, and show
  100 at a time (`@shkriuss/ui/long-lists`: one just saved stays in sight);
  how many a search finds is read out to screen readers once typing pauses
  ("1 closed trade found.").
- `src/pages/index.astro`: the page, built from `@shkriuss/ui` components.
  `<template>`s hold the markup for a trade and a line of "By setup" or "By
  month"; the trade form and "Delete a year" are dialogs.
- `src/worker.ts`: runs the shared sync server
  ([ADR 0010](../../docs/adr/0010-account-and-sync.md)). The newest change
  to each trade wins: one changed on two devices at once isn't kept twice,
  which would count it twice in the results. Parts are trades of their
  own, so closing part of a trade is never undone by a change to it. The
  trade form (also when closing) that's open while a sync (or another tab)
  changes the trade saves only what was changed in it (`readEdited`), so
  a stop loss moved there stays, and "Quantity closed", unless it was
  changed, is what's still open by then.
- `e2e/`: browser tests (`helpers.ts` is shared by them). The shared
  accessibility, security, offline and sync checks in `tests/e2e/` run too.

Its name, description, icon and colour are in
[`packages/registry/apps.json`](../../packages/registry/apps.json).
