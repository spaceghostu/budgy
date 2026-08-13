# Budgy

Pick your bank statement files and get a balance chart and spending insights back.
Everything happens in the browser — there is no server, no upload and no account.
The single exception is the optional **Ask Claude** card, which sends a summary of
totals to the Anthropic API under your own key, and only when you press it.

It reads two Discovery Bank exports, either on its own or both together:

| File                          | What it brings                                      |
| ----------------------------- | --------------------------------------------------- |
| **Certified statement** (PDF) | Every account, and the running balance on every row |
| **Smart Search export** (CSV) | The bank's categories, transaction types and times  |

Neither is complete alone, which is the point of taking both: the CSV lists amounts
but no balances, and the PDF has balances but no categories. Given both, the app
matches them row by row and you get real balances _and_ categorised spending.

The CSV column matching is alias-based, so most bank CSVs with a date, a description
and an amount will work. The PDF reader is written for Discovery's certified layout.

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
- **Where the money went** — by category and by merchant.
- **Charges that repeat** — debit orders, plus card merchants billing a steady
  amount roughly a month apart.
- **Highlights** — runway, surplus or shortfall, what the fees cost, the heaviest day.
- **Ask Claude** — a written read of the period, from the Anthropic API, under your own
  key. Opt-in, and the only thing here that sends anything anywhere. See
  [Asking Claude](#asking-claude).
- **Every transaction**, searchable and sortable, with the running balance.

Every chart has a table view, so no value is reachable only by hovering.

Pick **Month** in the period row and the whole dashboard narrows to one calendar
month, with arrows to step through them. The month-against-month chart is the
exception: it always shows every month, since a chart that compares months cannot
be scoped to one of them.

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

## Asking Claude

Every chart on the page is computed here. **Ask Claude** is the one feature that is
not: press it and a summary of the period goes to the Anthropic API and comes back as
a headline, a handful of findings and some suggested actions.

It sends **aggregates only** — the period, the totals, per-month flow, the top dozen
categories and merchants, the recurring charges and the biggest expenses reduced to
date, merchant, category and amount. Descriptions, notes, counterparties, account
names, account numbers and times are all dropped, and a test asserts they stay
dropped.

Beside it is an optional **note box**: a sentence or two saying what you want from the
read — a question, a goal, or something the statement cannot show. "Saving for a
deposit in June", "why was January so much worse than December", "ignore the medical
bills, they were a one-off". It steers what Claude looks at, and if it asks a question
the headline answers it. Whatever you type is sent word for word, so the card shows
the whole message — figures and note together — before you send it.

The key is yours. There is no server here to keep one behind, so you paste your own
key from [console.anthropic.com](https://console.anthropic.com/settings/keys), calls
are billed to it, and it is held in the page for the session unless you tick **Keep
this key in this browser**. Nothing is sent until you press the button.

## Privacy

Files are read with the File API and analysed in memory. Nothing is sent anywhere
unless you ask Claude for a read, which sends the aggregate payload described above
and nothing else. Closing the tab forgets them, unless you tick **Keep these files in
this browser** — which writes them to local storage on this device only.

`reference/` is gitignored, so sample statements stay out of the repository. Test
fixtures are synthetic rows in the same shape, never real data.

## Development

```sh
bun install
bun run dev            # http://localhost:5173
bun run build          # static bundle in build/
bun run preview
```

Checks:

```sh
bun run test           # unit tests (browser + node projects)
bun run test:coverage  # coverage for the pure modules
bun run check          # svelte-check
bun run lint           # prettier + eslint
```

## How it is put together

| Path                  | What lives there                                                             |
| --------------------- | ---------------------------------------------------------------------------- |
| `src/lib/parse/`      | CSV reading, PDF row assembly, the two-source merge, normalisation           |
| `src/lib/stats/`      | Balance series, period summary, breakdowns, recurring detection, highlights  |
| `src/lib/charts/`     | Scales, tick selection, SVG path builders                                    |
| `src/lib/ai/`         | The outbound payload, the prompt, the Anthropic call, the reply's validation |
| `src/lib/components/` | Charts, tables and the UI shell                                              |
| `src/lib/state/`      | The rune store, date-range presets, local persistence                        |

Everything in `parse/`, `stats/`, `charts/` and `ai/` is a pure function with unit
tests — `ai/client.ts` is the one exception, and its network call is specced against a
stubbed `fetch`. The components only render.

### Decisions worth knowing about

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
They count towards the balance and are excluded from income, spending and category
totals. The wording rule matters because PDF rows have no category column.

**Recurring detection is deliberately conservative.** A debit order counts on
sight — it is a standing mandate. A card merchant has to bill in two or more months,
at least 25 days apart, within 15% of the same amount. Without the span test a shop
on 31 July and another on 1 August looks monthly; without the amount test a
supermarket looks like a subscription.

**What leaves the browser is one function, plus whatever you typed.**
`ai/payload.ts` decides every figure Anthropic sees, so the answer to "what does it
send?" is a file you can read rather than a call site you have to find — and the note
box passes through verbatim on top of it, which is why the card previews the assembled
message rather than the JSON alone. Anything sent but not shown would make that
summary a lie.

The payload is built from the same `Insights` the cards render, so the model is shown
the period currently filtered — what is on screen and what is asked about stay the same
thing. Because a report cannot re-derive itself when the filters move, the card says
so, and says which of the two moved: the figures under it, or the question you asked.

**The reply comes back through a forced tool call.** A model asked for JSON in the
prompt will now and then wrap it in a sentence. Given a tool and `tool_choice`, it
returns a structured object every time — which is what lets the findings render with
the same tone markers as the locally computed highlights. It is still validated on
arrival: a tone the app cannot draw becomes neutral and a malformed finding is
dropped, but a report with no headline or no usable findings is rejected outright,
because an empty card should read as a failure rather than as an answer.

**The API key is the reader's own.** `adapter-static` and `ssr = false` mean there is
no server to hide a key behind, and shipping one in a static bundle would hand it to
everyone who loads the page. So the key is pasted in, held for the session by default,
and the request goes straight from the browser with
`anthropic-dangerous-direct-browser-access` — which is only defensible because the key
belongs to the person typing it.

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

**The month card's controls scope the card.** Everything else on the page answers to
the period row above it; this one chart cannot, because comparing months is exactly
what a period filter takes away. So its controls live in the card and reach no
further — the one deliberate exception to filters belonging in a single row.

### Charts

Colours and marks follow a validated palette: categorical slot 1 (blue) for the
single-series charts, the blue/red diverging pair for money in vs out, and status
tokens only where a number genuinely means good or bad. Both light and dark palettes
pass the colour-vision, contrast and lightness checks. Tokens live in
`src/lib/styles/tokens.css`.

**Many months are one hue, not many.** Twelve months on one plot is past the point
where categorical colours stay apart, and months are ordered anyway. So the
month-against-month chart is an emphasis chart: the month being read in
`--series-1`, every other in `--series-context`, the pale step of the same blue
ramp. The two clear the ordinal-ramp checks against both surfaces, and identity is
carried by the legend, the crosshair readout and the table rather than by hue.
