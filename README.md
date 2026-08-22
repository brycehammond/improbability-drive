# The Improbability Drive

A big red button. Press it and something wildly improbable is invented for
you, its probability calculated and reported with the seriousness of a 1978
laboratory instrument. Or describe something you are hoping for, and the Drive
will tell you, kindly but precisely, how unlikely it is.

> A single grey sock, missing since 1974 from a launderette in Basingstoke,
> rematerialises inside a sealed municipal weather station.
>
> **2^276,709 to 1 against.** Roughly as likely as a sperm whale appearing at
> 30,000 ft.

## What is here

| Path | |
|---|---|
| `/` | the button, and the scenario box |
| `/r/<id>` | a permalink to one report |
| `/about` | what this is |
| `POST /api/drive` | the endpoint that does the work |
| `GET /api/reports/<id>` | one report, as JSON |
| `GET /api/recent?limit=20` | the latest reports, newest first |

No framework, no bundler. Vanilla HTML, CSS and ES modules in `site/`; one
Azure Static Web Apps managed function in `api/`; Bicep in `infra/`. The
design is implemented from a Claude Design spec — its tokens, type scale and
every screen state live in `site/assets/app.css`.

## How it works

1. The page `POST`s `{mode: "random"}` or `{mode: "calculate", scenario}` to
   `/api/drive`.
2. The function picks an **improbability vector** — one of twenty flavours in
   `api/src/prompts.js`, from *horticultural* to *municipal* — for random
   mode, or wraps the submitted scenario in delimiters for calculate mode, and
   asks Claude for a report constrained to a JSON schema.
3. The report is finished (report number, date, formatted odds), stored, and
   returned. The page spins its counter for a couple of seconds regardless,
   because the joke needs a beat.
4. Permalinks read the stored report back by id.

`api/src/prompts.js` is the authored artifact. The voice lives in its system
prompt, and the vectors exist so that ten presses in a row do not all land on
petunias. Everything else is plumbing.

## Design notes

**The scenario is data, not instructions.** It is delimited, the system prompt
says to ignore anything inside it that reads like a command, and it never
appears in a system position. Refusals become *"The Drive respectfully
declines to contemplate that."* and are not stored.

**Two probability forms.** Astronomical odds are a power of two
(`2^276,709 to 1 against`); merely large ones are a plain integer
(`440,921 to 1 against`). History reconciles them with `log2Odds`, one number
that makes the two comparable.

**Storage is deliberately thin.** Reports go to Azure Table Storage: one
partition, row keys that sort newest-first, so recent is a prefix scan and a
permalink is a point read. Each row holds the report plus the fields worth
querying on their own. Nothing about who pressed the button is recorded.
Without a connection string the store is an in-memory map, so the whole site
runs locally with no account and no key — the function answers from a canned
report instead of calling anything.

**The key is server-side, always.** The browser only ever calls `/api` on its
own origin. The Anthropic key lives in the Static Web App's application
settings, reaches the function through its own environment, and is never in
the repository, never in the Bicep template, and never served to a browser.

**One command from an empty subscription.** `infra/main.bicep` is
subscription-scoped and parameterised end to end: resource group, storage
account, table, Static Web App and its settings, under any name in any
region. `infra/bootstrap.sh` federates GitHub Actions to Azure with OIDC, so
there is no password or publish profile stored anywhere. Deployment is a push.

## Running it

Node 24, then `npm install && npm test && npm run dev`. The function falls
back to a built-in mock when no API key is present, so it runs offline;
`?mock=1` does the same for the static preview.

Deployment and DNS specifics are not in this repository.

## Notes for later

- Rate limiting is a per-instance in-memory token bucket. Good enough for a
  button; a real cap belongs in the table alongside a daily spend limit.
- `/api/recent` has no page yet. It exists so the history is reachable.
