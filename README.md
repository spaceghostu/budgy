# Budgy

Pick your bank statement files and get a balance chart and spending insights back.
Everything happens in the browser — there is no server, no upload and no account.
The single exception is the optional **Ask Claude** cards, which send a summary of
totals to the Anthropic API under your own key, and only when you press one.

It also runs as a [desktop app](#desktop-app), which is the same bundle in a window
of its own rather than a second version of anything.

It reads two Discovery Bank exports, either on its own or both together:

| File                          | What it brings                                      |
| ----------------------------- | --------------------------------------------------- |
| **Certified statement** (PDF) | Every account, and the running balance on every row |
| **Smart Search export** (CSV) | The bank's categories, transaction types and times  |

Neither is complete alone, which is the point of taking both: the CSV lists amounts
but no balances, and the PDF has balances but no filing. Given both, the app
matches them row by row and you get real balances _and_ categorised spending.

The CSV column matching is alias-based, so most bank CSVs with a date, a description
and an amount will work — one without a `SubCategory` column simply arrives unfiled,
and the card described below is how it gets filed. The PDF reader is written for
Discovery's certified layout.

## What it shows

- **Balance over time** — a step line, one point per transaction, held until the
  next one moves it. Crosshair, tooltip and arrow-key navigation.
- **Money in against money out**, per day, or per month once the period is longer
  than a quarter and a bar per day would be a hairline.
- **Month against month** — every month's running total laid over the same days of
  the month, so this one can be read against the last. The month being looked at is
  drawn in full strength and the rest recede, with a dashed line for the typical
  month. Its own controls choose what to plot (net, money out, money in) and which
  months to draw.
- **What changed, month against month** — the same categories, or the same
  merchants, in a bar each across the months compared, with what moved between the
  last two of them. The card above says whether a month went differently; this one
  says what went differently. Its own controls choose category or merchant and
  which months to put side by side.
- **Where the money went** — by category and by merchant. A category here is the
  bank's `SubCategory`: `Groceries`, `Eating Out and Takeouts` and `Coffee` are three
  different decisions, where the bank's own heading makes them one "Food and Drink"
  bar you cannot act on. Open any of them — a bar, a row of the table, a single
  month's bar in the comparison — for the transactions behind it, and re-file them
  from there. Long tails fold into an `Other` row that opens to show every line.
- **Changing where something is filed** — open any category or merchant and re-file
  the merchants inside it. The bank's own filing is where a row starts, not where it
  has to stay, and every choice you make is listed and reversible under **Your
  categories**.
- **What the bank never filed** — the merchants behind the uncategorised spending,
  each with a category to give it, from the bank's own list or one you name yourself.
  The bank's list runs to sixty-odd names, so it is a search box rather than a scroll,
  with the handful you reached for last offered above the rest and the whole thing
  reachable from the keyboard. One choice covers every transaction from that merchant,
  in this statement and in next month's.
- **Charges that repeat** — debit orders, plus card merchants billing a steady
  amount roughly a month apart.
- **Between now and payday** — your balance today, carried forward day by day to
  the day before your next payday: down on each charge your own history names, on
  the day it usually lands, and down again by what the rest of a month usually
  costs. It says the lowest the balance gets, and warns you if it goes under.
  Learned from the last three or the last six complete months, whichever you ask
  for. Last month sits under it unticked, to say which of it is coming back — and
  you can untick what is not coming, or add what is not in these files at all. See
  [Forecasting](#forecasting).
- **A plan for getting through the month** — the same projection, read by Claude:
  which of the charges still to come could be moved, what each category has left to
  spend over the days remaining, and what that is worth by payday. Opt-in and under
  your own key, like the read on **Insights**. See [Asking Claude](#asking-claude).
- **Highlights** — runway, surplus or shortfall, what the fees cost, the heaviest day.
- **Ask Claude** — a written read of the period, from the Anthropic API, under your own
  key. Opt-in, and the only thing here that sends anything anywhere. See
  [Asking Claude](#asking-claude).
- **Every transaction**, searchable and sortable, with the running balance.

Every chart has a table view, so no value is reachable only by hovering.

Pick **Month** in the period row and the whole dashboard narrows to one calendar
month, with arrows to step through them. The two comparison cards on **Spending**
are the exception: a card that compares months cannot be scoped to one of them, so
they keep every month available and follow the period row only in where they start
— the month you are parked on is the one drawn in full strength, and the one the
comparison window ends at.

## Pages

Each page answers one question, and the account and period row above them scopes
every one at once — bar three. History lists statements, where a date range within
one says nothing about the others; net worth is a level across every account, which
needs the whole chain behind it; and forecast is learned from the months either side
of the one it is about, so it keeps the account and drops the period:

| Page            | What it answers                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/`             | Add files; what happened — balance, highlights, in against out                                                       |
| `/net-worth`    | What it all comes to, across every account                                                                           |
| `/spending`     | Where it went — month against month, what changed, category, merchant, filing; open any of them for its transactions |
| `/recurring`    | What repeats, and the biggest single hits                                                                            |
| `/forecast`     | How far the money goes — your balance from today to payday, what is still expected to leave, and a plan for saving   |
| `/transactions` | Every row, searchable — plus anything that could not be read                                                         |
| `/insights`     | Ask Claude to read the period — one of the two things that leave the device                                          |
| `/history`      | Every statement kept here — open one, delete one, delete all                                                         |

The statement lives above the routes, so moving between them does not re-read a
90-page PDF.

## Every upload is kept

Upload a statement and it is saved to this browser. Next month's export joins it
rather than replacing it, and **History** is the list — each entry showing the
period it covers, the accounts in it, how many rows, and when it was added. Open
one and the whole dashboard switches to it.

A statement is the **pair**, not the file: adding the CSV beside the PDF already
on screen completes that entry. **Start a new statement** is what makes the next
upload its own.

Storage is IndexedDB rather than local storage, which one certified PDF can fill
on its own. Nothing is uploaded; the history is this browser on this device, and
**Keep statements in this browser** on the History page turns it off and deletes
what is already there.

## Where the balances come from

**With the PDF**, they are the bank's own: the app reads the balance printed beside
each row, checks every one against the row before it, and checks each account's last
balance against the summary page. Anything that does not add up is reported rather
than drawn.

**Without it**, a CSV export lists amounts and no balances, so the chart plots
**net change** — the right shape, anchored at zero. Enter your current balance and
the app unwinds backwards from it to make every figure real. That anchor is stored
per account with the statement date it described, so next month's export does not
silently inherit last month's number.

Balances belong to one account, so selecting **All accounts** falls back to combined
net change; pick a single account for its real balance line.

## Forecasting

The **Forecast** page answers one question: _from what is in the account right now,
does the money reach payday_ — and if it dips, when, and how far. Everything else in
this app reports what happened; this is the one page making a claim about what has
not, so it is built to be checked rather than trusted.

**Payday is the day your month opens on.** Set it with the picker at the top of the
page — paid on the 25th, and the line runs to the 24th with the 25th as payday. Left
on the 1st, the line simply runs to the end of the calendar month. It is the same
setting the rest of the app cuts its months by, so nothing on any other page
disagrees with it.

The line starts at your balance on the last day the statement covers. Where the bank
printed balances it is the bank's own figure; where it did not, enter your current
balance on the overview and the line becomes real money rather than net change.

The rest of the month is two things, kept apart because they are known to very
different standards:

- **Committed** — the charges your history names: a debit order, a subscription, a
  salary. Each is placed on the day of the month it usually lands on, for what it
  usually takes — the middle month rather than the last, so a lender that doubled up
  once does not set the expectation for every month after it. Each one is a step down
  — or up, for a salary — on the line, marked on the day it lands. These are the
  expected payments, listed with the evidence behind each: how many months said so,
  whether the bank calls it a debit order, and whether it has already missed its usual
  day.
- **Everyday** — everything else, as one figure: what the rest of a month usually
  costs, spread evenly across the days that are left. Nobody can say which Tuesday the
  groceries happen, so it does not pretend to. The committed payments carry the shape
  of the line and this carries its drift.

A merchant belongs to exactly one of them. A charge the history calls recurring is
never counted again in the everyday figure — whether or not it has already billed this
month — or the same money would be forecast twice.

**Last month is on the list too, unticked.** The recurring test answers "what
repeats" conservatively and on purpose, which leaves it silent about most of a month —
so under the charges it did find sits every payee last month had that this month has
not seen yet, none of them counted. Tick anything you know is coming back and it joins
the list above at what its own history says it takes. Payees this month has already
seen are left out: they are in the banked figures already, and a row whose tick could
change nothing is worse than no row.

Read back through the other months from the picker beside it — every complete month the
statement has, not only the ones the projection learns from. A quarterly bill last paid
in March is exactly the thing you go looking for, and the six-month window is not what
bounds that question.

**Add what the history could not see.** The recurring test is deliberately
conservative, so a quarterly premium or a loan that moves about never qualifies — and a
bill paid from another account is not in these files at all. **Add a payment** takes
both. **Pick from history** lists every payee your statement knows with what it takes,
and one picked there is expected on its own history — which means a price that moves is
expected at the new one without being re-entered, and no amount or day has to be typed.
Type a
name the statement does not have and you give the amount and the day yourself; nothing
in the data backs it, so what you typed is exactly what is expected. Either way it is
kept, and a payee you vouch for replaces what the test found rather than sitting beside
it — one row, counted once.

**Untick anything that is not coming.** The history knows a gym membership has billed
every month; it cannot know you cancelled it this morning. Every expected payment has a
tick box, and clearing one takes it out of the projection — off the line, out of the
total, and out of the tiles. The row stays where it is, struck through, because its
absence is now what is moving the figures and a charge that vanished would be a worse
answer than one you can see you dropped. The choice is kept on this device, so next
month's export does not ask again — and it is a short-lived override either way: a
charge that really has stopped falls out on its own once it has missed two months, and
one that comes back arrives as a real transaction.

Both are learned from **complete** past months only, and only recent ones. Two years
of exports is a record, not an expectation: prices move, subscriptions are cancelled,
salaries change. Choose **last 3 months** or **last 6 months** — six is the standing
shape of a life, where one strange month is outvoted; three is where things stand now,
and knows about the raise. The choice sets what a charge is expected to cost and when,
and what the rest of the month runs to — and it can decide whether a charge is seen at
all: a subscription that went from R100 to R200 half a year ago varies too much for six
months to call it recurring, where three months see a steady R200 and expect it.

One rule is the same under either window, because both end at the same month: a charge
that has missed the last two whole months counts as stopped, and is dropped from both
channels. Money that is not coming should not be forecast either by name or by
average.

The months behind it are drawn pale for scale, and **Past months** turns them down to a
tenth rather than taking them away — a dozen of them can crowd the one line you came to
read, but removing them would move the axis under it and quietly change what the plot
says.

Around the projection is a band: where the month lands if the rest of it runs like the
leanest or the heaviest month behind it, with the single most extreme month on each
side set aside once there are four to spare them from. One car bought or one bonus paid
stretches a band until nothing else on the plot can be read, and a range you cannot
read inside is worse than no range at all.

Two things it will not do. It will not project a month it has no whole month behind —
the line simply holds where the statement stops, and says so. And "this month" means
the newest month in your statement, not the month on the calendar: like every other
period in this app, recent is relative to the data. The card says which day the banked
figures stop at.

## Asking Claude

Every chart on the page is computed here. **Ask Claude** is the one feature that is
not: press it and a summary goes to the Anthropic API and comes back as a headline, a
handful of findings and some suggested actions.

There are two of these cards, asking two different questions of two different sets of
figures:

- **On Insights — what the period came to.** A read of a month that has happened:
  what stands out in the totals, the categories and the charges that repeat. It sends
  the period, the totals, per-month flow, the top dozen categories and merchants, the
  recurring charges and the biggest expenses reduced to date, merchant, category and
  amount.
- **On Forecast — how to get through the month.** A plan for a month that has not
  finished: what is in the account, the named charges still to come with the day each
  lands, and what each category still has to take before payday. It answers with the
  same three parts, where the actions are the plan itself — which charge to move, what
  to hold a category to over the days left, and what each is worth by payday. It reads
  the projection **as it is on screen**: the window you chose, the charges you have
  ticked off, and the everyday spending only if the page is counting it.

Both send **aggregates and named charges only**. Descriptions, notes, counterparties,
account names, account numbers and times are all dropped, and a test on each payload
asserts they stay dropped.

The plan card knows what it cannot say. Without a running balance — no printed
balances and none entered on the overview — it is told the balances are a shape rather
than a level, and it talks about what the month costs and what could be saved instead
of claiming the account runs out. It is told the same about a debit order, which
cannot simply be skipped on the day, and about how few months it was learned from.

Beside each is an optional **note box**: a sentence or two saying what you want from
it — a question, a goal, or something the statement cannot show. "Saving for a deposit
in June", "why was January so much worse than December", "I need to keep R3 000 back
for tyres". It steers what Claude looks at, and if it asks a question the headline
answers it. Whatever you type is sent word for word, so the card shows the whole
message — figures and note together — before you send it.

**The read is a conversation, not a single answer.** Under the report is a follow-up
box: "break down those bank fees", "which of those subscriptions is the newest",
"what would cutting the takeaways in half be worth over a year". Claude answers with
everything it has already said in front of it, so a follow-up can lean on the report
above it, and each answer is added to the thread rather than replacing what it was
asked about. A follow-up resends the conversation so far — the same figures, every
question and every answer — and no new figures: the summary is fixed when the
conversation opens, so a longer thread costs more tokens but never widens what
Anthropic sees. **Start again** empties the thread and opens a new one from whatever
is on screen now.

The key is yours. There is no server here to keep one behind, so you paste your own
key from [console.anthropic.com](https://console.anthropic.com/settings/keys), calls
are billed to it, and it is held in the page for the session unless you tick **Keep
this key in this browser**. Nothing is sent until you press the button.

For a build only you load, you can configure the key instead of pasting it: put

```sh
ANTHROPIC_API_KEY=sk-ant-…
```

in `.env`, and `vite.config.ts` substitutes it into the bundle at build time. The card
then says it is using the key the build was given, and stops asking for one — it also
stops reading or writing a key in this browser, because a configured key is not the
reader's to keep or clear. **This bakes the key into the JavaScript that ships**, so it
suits your own machine or a page behind your own login, and nothing you hand out. Leave
the variable unset and the card asks each reader for their own key as before.

## Desktop app

The same app in a window of its own. Worth having for the same reason the history
is: a year of statements is easier to find in an app you open than in whichever
browser profile you happened to upload from.

```sh
bun run desktop        # the window, against the bundle in build/
bun run desktop:pack   # unpacked app in dist-desktop/
bun run desktop:dist   # an installer for the platform you are on
```

Nothing about the app changes by being run this way — same parsing, same charts,
same "nothing leaves the machine", with the one exception described under
[Updates](#updates) below. The shell in `electron/` is shell only: no application
logic, no preload, no IPC. The window is handed the web platform and the built
bundle, and that is all it has.

The bundle is served to it over `app://budgy` rather than `file://`. Chromium gives
a `file://` page an opaque origin, and an opaque origin has no IndexedDB — the window
would open, look right, and forget the library on the way in. A registered scheme has
a real origin and the same one on every launch, which is what makes a statement saved
today still there after an update.

An installer built from a tree with `ANTHROPIC_API_KEY` in `.env` carries that key
inside it, for the reason `src/lib/ai/env.ts` sets out: the key is substituted into
the bundle at build time, and an installer is a bundle that travels. Build the ones
you hand to other people from a tree without one, and let them enter their own.

Building an installer for another platform needs that platform's toolchain: a Windows
installer is built on Windows, or under Wine. Which is why the installers that get
handed out are built by [GitHub Actions](.github/workflows/release.yml) instead:
pushing a `v*` tag builds Windows and Linux from the one command, and a CI checkout
has no `.env`, so an installer built there cannot carry a key that was never there.

```sh
git tag v0.1.0 && git push origin v0.1.0
```

### Updates

The desktop app checks GitHub for a newer release when it starts, and says what it
found on a card at the foot of the page — which also carries a **Check for updates**
button for asking again.

This is the one thing the app does over the network without being asked, so it is
worth being exact about. A check is a GET of the release list for a public
repository. It carries no statement, no figure, no key and nothing identifying, and
it fetches nothing: an update that is found is _offered_. The download is the better
part of a hundred megabytes and starts only when you press the button, and the
update is installed only when you quit. A failure is a line on the card rather than
a dialog — an app that cannot reach GitHub still reads statements perfectly well.

The window asks the shell about all this the same way it asks for everything else:
an ordinary same-origin `fetch` of a path under `app://budgy/-/`, answered by the
protocol handler that already serves the bundle. There is still no preload, nothing
on `window` and no IPC, so the bundle remains a page a browser could run unchanged —
on the web the card is not rendered and no request is made.

macOS is not covered. An app that updates itself has to be signed for macOS to
launch the replacement, and there is no certificate here.

## Privacy

Files are read with the File API and analysed in memory. Nothing is sent anywhere
unless you ask Claude for a read, which sends the aggregate payload described above
and nothing else. The desktop app additionally asks GitHub whether there is a newer
release when it starts — a request that carries nothing about you or your statements,
and is described under [Updates](#updates).

Every statement you open is kept in this browser's IndexedDB, on this device only,
so that a reload does not lose it and a year of exports builds into a history. That
is on by default, because a history you have to opt into every month is not one —
and it is a change from earlier versions, which kept a single statement and only if
you asked. Untick **Keep statements in this browser** on the History page to turn it
off, which also deletes what is already there; **Delete every statement** does the
same without changing the setting. A statement kept under the old scheme is read
once on upgrade and becomes the first entry rather than being dropped.

The categories you choose for merchants are kept on this device without asking, since
a merchant name and a label are your own filing rather than your bank's record —
and the work of filing a month's stray rows is worth carrying into the next export.
Kept alongside them are any category names you invented and the handful you reached
for last, which is what lets the picker offer both again next month. Deleting your
statements leaves them in place; each rule is removable from the card that set it.

The desktop app is a separate origin from the browser, so the two keep separate
libraries — a statement kept in one is not visible in the other, and opening the
file again is how it crosses. That is the same wall a browser puts between two
sites, and it is the right one: neither can read the other's statements.

`reference/` is gitignored, so sample statements stay out of the repository. Test
fixtures are synthetic rows in the same shape, never real data.

## Development

```sh
bun install
bun run dev            # http://localhost:5173
bun run build          # static bundle in build/
bun run preview
bun run desktop:dev    # the desktop window, against the dev server above
bun run desktop        # the desktop window, against build/
```

The desktop scripts go through `electron/launch.js` rather than calling `electron`
directly. Editors that are themselves Electron apps — VS Code among them — export
`ELECTRON_RUN_AS_NODE` into their integrated terminal, and the binary obeys it: no
window, and a puzzling error about a missing export instead of an app. A packaged
build started from that same terminal has the same problem and no launcher to fix
it — `env -u ELECTRON_RUN_AS_NODE ./budgy` is the way to run one by hand.

If `bun install` leaves the Electron binary missing — "Electron failed to install
correctly" — run `node node_modules/electron/install.js`. Bun blocks lifecycle
scripts for packages it has not been told to trust, which is what `trustedDependencies`
in `package.json` is for.

Checks:

```sh
bun run test           # unit tests (browser + node projects)
bun run test:coverage  # coverage for the pure modules
bun run check          # svelte-check
bun run lint           # prettier + eslint
```

## How it is put together

| Path                     | What lives there                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `src/lib/parse/`         | CSV reading, PDF row assembly, the two-source merge, normalisation                            |
| `src/lib/stats/`         | Balance series, period summary, breakdowns, month comparison, recurring detection, highlights |
| `src/lib/charts/`        | Scales, tick selection, SVG path builders                                                     |
| `src/lib/ai/`            | The outbound payloads, the prompts, the Anthropic call, the reply's validation                |
| `src/lib/components/`    | Charts, tables and the UI shell                                                               |
| `src/lib/components/ui/` | shadcn-svelte primitives, generated by its CLI                                                |
| `src/lib/state/`         | The rune store, date-range presets, the statement library, local persistence                  |
| `src/routes/`            | One page per question, over the state the layout provides                                     |
| `electron/`              | The desktop shell: the `app://` scheme, the window, and packaging                             |
| `src/app.css`            | Tailwind entry, the palette, and the shadcn theme mapped onto it                              |

Everything in `parse/`, `stats/`, `charts/` and `ai/` is a pure function with unit
tests — `ai/client.ts` is the one exception, and its network call is specced against a
stubbed `fetch`. The components only render.

The UI is [shadcn-svelte](https://shadcn-svelte.com) on Tailwind v4. Its primitives are
generated into `src/lib/components/ui/` and owned here, so `shadcn-svelte add` will
overwrite them — the one local edit so far is a height cap on the select panel, noted in
the file. The charts keep their own scoped CSS, because their marks are SVG and a
stylesheet says that better than a class list.

### Decisions worth knowing about

**A history entry is a statement, not a file.** The two exports describe the same
money, so a `(pdf?, csv?)` pair is one entry: adding the second file to what is on
screen completes it, and **Start a new statement** is the explicit act that opens
the next. Filing each file separately would have broken the merge — the whole point
of taking both — the first time someone uploaded a pair.

**Saved statements go in IndexedDB, and only the summary is read to list them.**
Local storage could not hold a history: a certified PDF runs to hundreds of
kilobytes and base64 made it a third larger again, which is why keeping even one
could hit the quota. IndexedDB takes bytes as bytes. It is two object stores rather
than one, so drawing the History page reads dates and names and not every megabyte
of every statement — and both are written in a single transaction, since a list
naming a statement whose files never landed would offer something that cannot open.

Only the summary is stored, never derived figures: a saved statement is re-parsed
when opened, so `parse/` stays the single place that interprets a file and a fix
there reaches statements filed before it.

**Keeping uploads is on by default, which reverses what this app used to do.**
Keeping one statement was a convenience worth asking about. A history is the
feature, and one you have to opt into every month is not one. It stays revocable
from the same control — which deletes what is already kept, because "stop keeping
my statements" is not a request to leave the existing ones on disk.

**The state is provided by the layout, not imported by the pages.** Held in context
rather than as a module singleton, so nothing touches local storage at import time,
and `restore()` runs once for the whole app rather than per page. That is also what
lets the account and period row live in the layout, above every page it scopes.

**The PDF is the spine, the CSV is enrichment.** The certified statement is the
record: it decides the dates, amounts and balances. The CSV only fills in the
columns a PDF has no room for. A CSV row that matches nothing is reported, not
quietly folded in.

**Matching is by amount within a settlement window, not by date.** The two exports
date the same purchase differently — the CSV when it happened, the statement when it
settled, usually a day or so later. Matching on the date alone finds barely half of
them; matching on amount within a window, preferring identical wording, finds 99.8%
of a real 2,854-row export.

**Only pdf.js knows what a PDF is.** `parse/pdf.ts` is a thin loader that extracts
positioned text; every rule about what a statement looks like lives in
`parse/pdf-rows.ts` as a pure function over `{str, x, y, width}` items, unit-tested
with synthetic pages.

**Transfers are not spending.** Rows the bank files under
`Not for Financial Analyser`, plus `Transfer` / `Scheduled transfer` / `Re-direct`
types and `Inter account transfer` wording, move money between your own accounts.
They count towards the balance and are excluded from income, spending and the
breakdowns. The wording rule matters because PDF rows have no category column.

**A category here is the bank's sub-category.** The bank files at two levels: a dozen
broad headings, and a finer label under each. `Groceries`, `Eating Out and Takeouts`
and `Coffee` are three decisions a reader can act on; "Food and Drink" is one bar they
cannot. So the finer label is what `Transaction.category` holds and what every
breakdown, list and export means by category.

The heading is kept alongside as `bankCategory`, and is read for exactly one thing:
what a row _is_. `Not for Financial Analyser` and `Fees and Interest` are stated at
that level, so classification reads it rather than the category. Classifying from the
finer label instead would mean a sub-category the bank added under
`Not for Financial Analyser` silently counting as spending.

**Categories you add are keyed by merchant, not by transaction.** A transaction's id
is its position in a file (`csv:31`, `12345678901:4`), so loading the PDF beside the
CSV — or opening next month's export — renumbers them, and a label keyed by id would
quietly land on a different transaction. A merchant is derived from the description
and survives both. A relabelled row also takes the bank heading its new category sits
under — from this statement's own pairings, or the bank's published taxonomy — so the
transfer and fee rules still apply: filing a merchant under `Transfers` takes it out
of spending exactly as it would have been had the bank filed it that way. A name you
invented sits under no heading the bank knows, so such a row keeps the classification
it arrived with: renaming a bucket says nothing about whether the money left the
household.

**The bank's filing is the default, not the ceiling.** A rule overrides what the bank
said, because the reader is the one who knows the hardware shop was a birthday present
and not home improvement — and a breakdown you cannot correct is one you stop trusting.
This reverses what the app used to do, where a choice only ever reached rows the bank
had left blank; the halfway version, where the choice is stored and the bar never
moves, would have been worse than either.

What keeps that safe is that overrides are visible and reversible in one place.
**Your categories** on the Spending page lists every rule with how many rows it
moves — rows the bank filed included, since that is the count that says what the
choice is doing — and clearing one puts the bank's own filing back. A rule naming the
category a merchant already sits under counts nothing, which is the honest reading of
a choice that has since become what the bank says anyway.

A category of your own needs no list of its own: it is on offer for as long as
something is filed under it, whether that is a row in these files or a choice waiting
for the merchant to reappear. A name already in use resolves to the one that is there
— type `groceries` and it files under `Groceries`, rather than splitting the same
spending across two spellings of it.

**Recurring detection is deliberately conservative.** A debit order counts on
sight — it is a standing mandate. A card merchant has to bill in two or more months,
at least 25 days apart, within 15% of the same amount. Without the span test a shop
on 31 July and another on 1 August looks monthly; without the amount test a
supermarket looks like a subscription.

**What leaves the browser is one function per question, plus whatever you typed.**
`ai/payload.ts` decides every figure the period read sends and `ai/forecast-payload.ts`
every figure the plan sends, so the answer to "what does it send?" is a file you can
read rather than a call site you have to find — and the note box passes through
verbatim on top of it, which is why the card previews the assembled message rather
than the JSON alone. Anything sent but not shown would make that summary a lie.

Each payload is built from the same object its page renders — `Insights` for the
period, `Runway` for the plan — so the model is shown what is on screen, edits and
filters included, and what is on screen and what is asked about stay the same thing.
Because a report cannot re-derive itself when the figures move, the card says so, and
says which of the two moved: the figures under it, or the question you asked.

**One card, asked twice.** The key, the note box, the preview, the conversation, the
follow-ups and every failure message are the same job whichever page is asking, so
`AiReportCard.svelte` is written once and the question travels in as props: the
instructions, the forced tool, the message builder and the wording. A second copy is
where two sets of promises about what leaves the browser would quietly drift apart.

**The reply comes back through a forced tool call.** A model asked for JSON in the
prompt will now and then wrap it in a sentence. Given a tool and `tool_choice`, it
returns a structured object every time — which is what lets the findings render with
the same tone markers as the locally computed highlights. It is still validated on
arrival: a tone the app cannot draw becomes neutral and a malformed finding is
dropped, but a report with no headline or no usable findings is rejected outright,
because an empty card should read as a failure rather than as an answer.

**A follow-up is that same forced call, one turn later.** Answering in prose would
mean a second schema and a second way to draw an answer, so every turn comes back as
a report and renders identically. That shapes the wire format: the API will not carry
a conversation past a tool call that was never answered, so each reply is sent back
verbatim as the assistant's turn and the follow-up rides with a `tool_result` for the
call above it rather than arriving as a message of its own. The opening message is
kept as it was sent rather than rebuilt — the filters can move under a live
conversation, and rebuilding it would rewrite a question Claude has already answered
and leave its first reply describing numbers that were never sent.

**The API key is the reader's own.** `adapter-static` and `ssr = false` mean there is
no server to hide a key behind, and shipping one in a static bundle would hand it to
everyone who loads the page. So the key is pasted in, held for the session by default,
and the request goes straight from the browser with
`anthropic-dangerous-direct-browser-access` — which is only defensible because the key
belongs to the person typing it.

`ANTHROPIC_API_KEY` in `.env` is the one exception, and it is deliberately awkward:
the variable carries no `PUBLIC_` prefix, so `$env` will not hand it to the browser
and `vite.config.ts` has to substitute it explicitly. Putting a key in a bundle should
be a decision someone makes in the open, once, rather than a naming convention that
makes it routine — `src/lib/ai/env.ts` says what it costs, and the card tells the
reader on screen which key their press will spend.

**A month's running total starts at zero.** Overlaying the raw balance instead
would stack the months at whatever height each happened to sit at, and the shapes
could not be compared, which is the only reason to draw them together. The default
is net — money in less money out, the same figure the Net tile reports — and the
card can also plot either side on its own, where the line climbs so that more spent
reads as higher. A month the statement runs past is drawn to its last day; the
newest month stops where the data does, because carrying it on to the 31st would
draw a flat week that only means "not yet exported".

**The typical month is a median, not a mean.** One ruinous month drags a mean to a
level no month ever reached, and the point of the line is to say what a normal month
looks like by this day. It is taken across the months currently drawn, so narrowing
the selection re-derives it.

**A comparison card's controls scope the card.** Everything else on the page answers
to the period row above it; the two comparison cards cannot, because comparing
months is exactly what a period filter takes away. So their controls live in the
cards and reach no further — the deliberate exception to filters belonging in a
single row, and the reason both are fed the account's whole history rather than the
filtered slice.

The period row still reaches them in one direction: it says where the reader is
looking. Month against month draws that month in full strength; what-changed opens
its window ending there. Neither is scoped by it, and choosing months in either card
stops it following — a selection that shifted under the reader when they changed the
period would not be a selection.

**A comparison says what moved, not whether it was good.** `stats/compare.ts` puts
one column per month against a category or a merchant, and reports the newest column
against the one before it — the last two rather than the ends of the run, because
the question six columns provoke is what moved _this_ month, and the whole run is
already on screen to read the longer drift off. It is written in neutral ink
throughout. On a spending total every figure is positive by construction, and a
category that took less is not automatically good news: it is as easily the month a
debit order failed to collect.

A label absent from a month gets a zero rather than a gap — it was not unknown, it
was not spent — and a month that is asked for and had nothing in it keeps its column,
because that is the answer to the question rather than a reason to redraw it. The
bars are all measured against the heaviest single month on the card, since the only
reason to put the months in one picture is that the lengths mean the same thing.

**A bar and the list behind it are the same figure.** Clicking a category or a
merchant opens the transactions it counted, and `stats/compare.ts` builds that list
by the rule the bar was built by: spending only, from the same slice, under the same
label. A list that quietly included a refund would total to something the bar does
not say. The dialog prints the total in its header for that reason — it is the
clicked figure, and if the two ever drift apart it is visible rather than buried.

Which slice depends on which figure was clicked, because the two cards are scoped
differently. A breakdown bar opens the period-filtered slice the breakdown was built
from; a comparison bar reaches past the period row, so it opens the account's whole
history narrowed to the months that bar stood for — its own month for a month's bar,
all of them for the row's heading. The dialog names whichever it is, since a total
with no period attached is a number with no question attached.

The folded `Other (n)` row is a way in, but to a different thing: it names no
category, so there is no list of transactions behind it, and clicking it opens the
labels it stands for instead. It wears a chevron and says "show them" so it cannot be
mistaken for the rows beside it. One row genuinely opens nothing — in the comparison
table, a month that took nothing, because an empty list is not an answer anyone
clicked for. Every other affordance is offered in the chart and the table alike — the
two views of a card cannot disagree about what a reader may do.

**A fold is a default, not a ceiling.** A breakdown is read for the few lines that
carry the money, so the two chart views show eight and fold the rest — and then open
on a click, because a total you cannot break down is one you end up mistrusting. The
tables never folded at all; they have always listed every line. Nothing about the
palette argues for keeping the fold shut, either: the breakdown bars are all one
series blue and the comparison bars are coloured by month, so a longer tail adds rows
rather than hues. Opening the tail can rescale the bars, which is the fold being
undone rather than the chart moving about — a folded row heavy enough to be the
tallest thing on the card was compressing the real ones against it.

**Whether a month is whole is read from the whole statement, not from spending.**
A month whose first _purchase_ falls on the 9th is a quiet week, not an export that
opened late, and hedging it would put an asterisk on most months. So the partial
flag is computed over every transaction, by the same rule `stats/monthly.ts` uses,
and it is judged against the statement rather than against the selection: leaving
June out of a comparison does not put July in doubt. It matters more here than on
the lines, because a month the export stops half-way into looks like a month of
thrift beside a whole one.

### Charts

Colours and marks follow a validated palette: categorical slot 1 (blue) for the
single-series charts, the blue/red diverging pair for money in vs out, and status
tokens only where a number genuinely means good or bad. Both light and dark palettes
pass the colour-vision, contrast and lightness checks. Tokens live in `src/app.css`,
where they also back shadcn-svelte's semantic names — so the components and the charts
are painted from one palette rather than two.

**Many months are one hue, not many.** Twelve months on one plot is past the point
where categorical colours stay apart, and months are ordered anyway. So the
month-against-month chart is an emphasis chart: the month being read in
`--series-1`, every other in `--series-context`, the pale step of the same blue
ramp. The two clear the ordinal-ramp checks against both surfaces, and identity is
carried by the legend, the crosshair readout and the table rather than by hue.
