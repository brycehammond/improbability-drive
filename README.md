# The Improbability Drive

improbabilitydrive.com. A big red button. Press it and something wildly
improbable is invented for you, its probability calculated and reported with
the seriousness of a 1978 laboratory instrument. Or describe something you are
hoping for, and the Drive will tell you, kindly but precisely, how unlikely it
is.

- `/` the button, and the scenario box
- `/r/<id>` a permalink to one report
- `/about` what this is
- `POST /api/drive` the endpoint that does the work
- `GET /api/reports/<id>` one report, as JSON
- `GET /api/recent?limit=20` the latest reports, newest first

No framework, no bundler. Vanilla HTML, CSS and ES modules in `site/`; one
Azure Function in `api/`. The design is implemented from the Claude Design spec
"The Improbability Drive v2" (tokens, type, and every screen state are in
`site/assets/app.css`).

## How it works

1. The page `POST`s `{mode: "random"}` or `{mode: "calculate", scenario}` to
   `/api/drive`.
2. The function picks an **improbability vector** (one of twenty flavours in
   `api/src/prompts.js`) for random mode, or wraps the user's scenario in
   delimiters for calculate mode, and asks Claude for a report constrained to
   a JSON schema. The voice lives in the system prompt; that file is the
   authored artifact.
3. The report is finished (report number, date, formatted odds), stored, and
   returned. The page spins the counter for a couple of seconds regardless,
   because the joke needs a beat.
4. Permalinks read the stored report back by id.

The user's scenario is treated as data: it is delimited, the system prompt
says to ignore instructions inside it, and it never appears in a system
position. Refusals become "The Drive respectfully declines to contemplate
that." and are not stored.

## Storage

History goes to **Azure Table Storage**, table `reports`, one partition, row
keys that sort newest-first. Each row holds the full report JSON plus the
fields worth querying on their own: `mode`, `vector`, `scenario`, `exponent`,
`mantissa`, `log2Odds` (one number for "how improbable", comparable across
both probability forms), `stamp`, `date`. Nothing about who pressed the button
is recorded.

Without `TABLES_CONNECTION_STRING` the store is an in-memory Map, so local
runs need no account. Azurite works for a local table:

    npx azurite-table --silent &
    # in api/local.settings.json: "TABLES_CONNECTION_STRING": "UseDevelopmentStorage=true"

## Local development

Node 24.

    npm install                 # also installs api/
    npm test                    # unit tests, no network
    npm run build               # -> dist/, with _headers and staticwebapp.config.json
    npm run preview             # serves dist/ with production headers, no API
    npm run dev:api             # the function, via Azure Functions Core Tools, on :7071
    npm run dev                 # SWA emulator on http://localhost:4280, proxying /api to :7071

Run `dev:api` and `dev` in two terminals. (`swa start` can host the function
itself, but its bundled Core Tools download is flaky on macOS; `func` from
Homebrew or npm is dependable.) Copy `api/local.settings.example.json` to
`api/local.settings.json` and fill in `ANTHROPIC_API_KEY`. With no key the
function answers from a built-in mock, so the whole thing runs offline.

On the static preview (no API), append `?mock=1` to any page to render the
sample report.

### Settings

| Setting | Where | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | SWA app setting / `local.settings.json` | Server-side only. Never reaches the browser. |
| `MODEL` | same | Defaults to `claude-opus-5`. |
| `TABLES_CONNECTION_STRING` | same | Azure Storage connection string. Unset = memory. |

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`, which provisions the
Azure resources with Bicep and then uploads the built site and the function.
There is nothing to click.

`infra/main.bicep` is subscription-scoped and creates everything from nothing:
the resource group, a storage account with the `reports` table, the Static Web
App, and its application settings. The Anthropic key is passed in as a secure
parameter and lands only in the Static Web App's settings, where the managed
function reads it out of its own environment. It is never in the repository,
never in the template, and never served to a browser.

To deploy by hand instead:

    ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" az deployment sub create \
      --location westus2 \
      --template-file infra/main.bicep \
      --parameters infra/main.bicepparam

    export SWA_CLI_DEPLOYMENT_TOKEN="$(az staticwebapp secrets list \
      -n improbabilitydrive -g improbabilitydrive-rg --query properties.apiKey -o tsv)"
    npm run build && npm run deploy

`infra/main.bicepparam` reads every parameter from the environment with a
working default, so the same two commands deploy anywhere: set `APP_NAME`,
`AZURE_LOCATION`, `AZURE_RESOURCE_GROUP` and friends to move it. (A
`.bicepparam` file has to assign every parameter itself, so this is also what
makes the template overridable at all -- Azure CLI refuses to combine a params
file with inline `--parameters`.) The key being an environment variable rather
than an argument keeps it out of the process list too.

An empty `ANTHROPIC_API_KEY` is legal and deploys in mock mode: the function
answers from a canned report and calls nothing. Useful for a first look at the
infrastructure before committing a key to it.

### Deploying to your own account

The whole thing is parameterised, so it goes into any subscription under any
name. Fork or clone the repository, then:

    gh repo create my-drive --public --source . --push
    ./infra/bootstrap.sh
    gh secret set ANTHROPIC_API_KEY

`infra/bootstrap.sh` creates a Microsoft Entra app registration, federates
GitHub Actions to it with OIDC (so there is no password or publish profile to
store), grants it Contributor on the subscription, and writes the repository
secrets and variables below. Override any of its defaults with environment
variables:

    APP_NAME=mydrive AZURE_LOCATION=westeurope ./infra/bootstrap.sh

Then push, and the workflow does the rest.

| Repository secret | Meaning |
|---|---|
| `AZURE_CLIENT_ID` | The federated app registration. Set by `bootstrap.sh`. |
| `AZURE_TENANT_ID` | Set by `bootstrap.sh`. |
| `AZURE_SUBSCRIPTION_ID` | Set by `bootstrap.sh`. |
| `ANTHROPIC_API_KEY` | Yours. The only thing the script will not invent. |

| Repository variable | Default | Meaning |
|---|---|---|
| `APP_NAME` | `improbabilitydrive` | Names the Static Web App and seeds every other name. |
| `AZURE_LOCATION` | `westus2` | Resource group and storage account. |
| `SWA_LOCATION` | `westus2` | Static Web Apps run in a short list of regions. |
| `AZURE_RESOURCE_GROUP` | `improbabilitydrive-rg` | Created if absent. |
| `SWA_SKU` | `Free` | Or `Standard`. |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Which model writes the reports. |

Every variable has a working default, so a deployment that only sets the four
secrets lands a complete site.

### Custom domain

The live site is `gentle-plant-0d3534a1e.7.azurestaticapps.net`. Pointing a
domain at it takes two records, and a third that depends on what your
registrar supports.

Register the domain with the app first, which is what produces the validation
token:

    az staticwebapp hostname set -n improbabilitydrive -g improbabilitydrive-rg \
      --hostname improbabilitydrive.com --validation-method dns-txt-token

    az staticwebapp hostname list -n improbabilitydrive -g improbabilitydrive-rg \
      --query "[].{domain:name, status:status, token:validationToken}" -o table

Then, at the registrar:

| # | Type | Host | Value | For |
|---|---|---|---|---|
| 1 | `CNAME` | `www` | `gentle-plant-0d3534a1e.7.azurestaticapps.net` | the `www` subdomain |
| 2 | `TXT` | `@` | the validation token from the command above | proving you own the apex |
| 3 | `ALIAS` / `ANAME` | `@` | `gentle-plant-0d3534a1e.7.azurestaticapps.net` | routing the apex |

Record 3 is the awkward one. DNS forbids a `CNAME` at the apex, so pointing a
naked domain at a hostname needs an `ALIAS`/`ANAME` record (or CNAME
flattening), which not every registrar offers.

`improbabilitydrive.com` is on **Namecheap** BasicDNS, which does support
`ALIAS`, so all three records go in *Domain List -> Manage -> Advanced DNS ->
Add New Record*. Two things to watch there:

- Namecheap gives a parked domain a default `CNAME` on `www` pointing at
  `parkingpage.namecheap.com`, and sometimes a URL Redirect on `@`. **Delete
  both**, or they will win over the records above.
- Namecheap writes a trailing dot on `CNAME`/`ALIAS` values. That is normal
  and correct; leave it.

If your registrar does *not* offer `ALIAS`, the alternatives, in order of
preference:

1. **Forward the apex to `www`** at the registrar, and treat
   `www.improbabilitydrive.com` as the real address. Costs nothing and keeps
   the app globally distributed.
2. **Move DNS to Azure DNS** (or Cloudflare, which flattens CNAMEs). The
   registrar stays where it is; only the nameservers move.
3. **An `A` record** to the app's `stableInboundIP`. Azure recommends against
   it -- it pins every visitor to one regional host and gives up the global
   distribution -- and the field is empty on this app, so it is not currently
   an option anyway.

`www` has to be registered separately, and only *after* its `CNAME` resolves,
because that is how Azure validates it:

    az staticwebapp hostname set -n improbabilitydrive -g improbabilitydrive-rg \
      --hostname www.improbabilitydrive.com --validation-method cname-delegation

Validation is not instant and apex changes can take up to 72 hours to
propagate. Certificates are issued automatically once a domain reaches
`Ready`; there is nothing to buy or renew.

## Notes for later

- Rate limiting is a per-instance in-memory token bucket (20/min per IP).
  Good enough for a button; a daily spend cap would live in the same table.
- `/api/recent` has no page yet. It exists so the history is reachable.
