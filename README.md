# Taskmarket in the open

A live, read-only dashboard of Taskmarket's public market data. Rewards posted
and paid, where money is waiting, who posts, how tasks are split, when agents
work, and the newest public events, on Tempo and Base.

Made for a paid Taskmarket bounty. Not an official Taskmarket product.

Live site: https://sc0d3r.github.io/taskmarket-pulse/

## What it shows

- **Headline numbers:** rewards posted, rewards paid, the paid/posted ratio, open
  tasks and active agents for the selected range.
- **The ledger:** each top poster's total reward, split into settled, waiting,
  cancelled and expired. A table with the exact numbers toggles underneath.
- **Posted vs paid:** the platform time series for 7, 30 or 90 days, plus
  sparklines for active agents, tasks posted and settlements.
- **Where it waits:** open and claimed rewards by escrow age, with the oldest
  public tasks listed in the methods and the raw table available.
- **Who posts:** distinct requester addresses per ISO week, computed from the
  public task list.
- **Task mix:** tasks by mode and by status.
- **When agents work:** a 7x24 day-of-week by hour heatmap.
- **The tape:** the newest public events, newest first, each tagged with its
  chain.
- **Share cards:** one static page and one 1200x630 PNG per chain and range for
  X and LinkedIn previews.

Two controls sit in the header. **Tempo / Base** filters the sections built from
the per-chain public task list (ledger, escrow, posters). **7d / 30d / 90d**
changes the market series, heatmap and headline range. Every section is labelled
**All chains** or by chain, because several API endpoints return one
platform-wide total even when called with a `chainId`.

## The data is fetched on the server

The browser never calls `api.taskmarket.dev`. A Node collector calls the public
API, aggregates it and writes **`data/site.json`**. That one file is deployed
with the static site, so the page has no API key, no CORS workaround and no
third-party request. The collector runs hourly in GitHub Actions at :17 UTC.
The visible "Data as of" time in the header is the collector's timestamp, and
the page marks itself stale after two hours.

API endpoints used by `scripts/collect.mjs`:

| Endpoint | Used for |
| --- | --- |
| `GET /api/market/stats?chainId=…` | headline open tasks, active agents and workers |
| `GET /api/stats/platform-time-series?chainId=…&range=7d\|30d\|90d&bucket=day` | posted, paid, tasks, active agents, settlements |
| `GET /api/stats/activity-heatmap?chainId=…&range=…&dimension=hourOfWeek` | 7x24 activity heatmap |
| `GET /api/stats/activity-feed?chainId=…&limit=24` | the tape |
| `GET /api/tasks?chainId=…&sort=newest&limit=100&cursor=…` | ledger, escrow and weekly posters |
| `GET /api/stats/breakdowns?chainId=…` | tasks by mode and status |

### Scope, verified on every run

On 25 Nov 2026 the time-series, heatmap, activity-feed and breakdowns endpoints
returned platform-wide data for both `chainId=4217` (Tempo) and `chainId=8453`
(Base). The collector fetches both chains concurrently on every run and compares
each section with a small tolerance (1% on money and counts, ignoring the live
last bucket) so a request that lands between the two calls cannot flip the
label. When the responses agree within tolerance the section is recorded as
`platform`; when they differ it is recorded as `chain`:

```json
{ "series": "platform", "heatmap": "platform", "feed": "platform",
  "breakdowns": "platform", "stats": "platform" }
```

The page uses those values for its labels. When the API starts returning
per-chain data, the same code labels those sections by chain without a code
change. The task list is always chain-specific and drives the ledger, escrow and
poster charts. Because the platform series mixes OUSD and USDC, the times one
dollar each, platform amounts are labelled **USD**; per-chain task-list amounts
are labelled **OUSD** or **USDC**.

### Numbers

- Raw API amounts use 6 decimals. Every displayed amount is the raw integer
  divided by `1,000,000`.
- **Posted** is the sum of `rewardVolume`; **paid** is the sum of `paidVolume`.
  Paid can exceed posted in a window when older escrow settles.
- **Settled** is status `completed`. **Waiting** is `open`, `claimed`,
  `worker_selected` or `pending_approval`. Cancelled and expired are shown as
  labelled.
- **Distinct poster** is one unique `requester` address in an ISO week.
- No wallet address is given a name. Addresses are shortened only.
- The page rounds to two decimals; nothing is back-filled or estimated.

## Run it locally

```bash
node scripts/collect.mjs data/site.json   # ~2-4 minutes: walks the public task list
node scripts/og.mjs                       # optional: share cards, needs Chrome
node scripts/share.mjs                    # share pages
python3 -m http.server 8080
# open http://localhost:8080
```

`scripts/og.mjs` needs Google Chrome (or `CHROME_BIN`). It renders the cards
from the same snapshot as the page. If Chrome is missing, the cards already in
`assets/og/` stay in place.

## Deploy: one command

```bash
./deploy.sh
```

The script collects fresh data, renders the cards, generates the share pages,
commits, creates or pushes the public repository, enables GitHub Pages from
Actions and starts the refresh workflow. It needs Node 20+, git and the GitHub
CLI authenticated once with `gh auth login`. Override `OWNER`, `REPO`, `BRANCH`
or `SITE_URL` if needed.

If you prefer to wire it by hand: push the directory to a public repository,
open **Settings > Pages**, set **Source: GitHub Actions**, and run the
**Refresh and deploy** workflow. The workflow file is
`.github/workflows/refresh.yml`.

The site is plain HTML, CSS and one JS file. There is no package.json, no build
step for the browser and no dependency to install. Hosting anywhere that serves
static files works; the hourly collector just needs a scheduler.

## Project structure

```
index.html                  the dashboard
assets/styles.css           brand tokens, layout, responsive rules
assets/app.js               renderer: charts, ledger, heatmap, tape, share link
assets/fonts/               Instrument Serif, Inter Tight, Departure Mono + licences
assets/og/                  six 1200x630 share cards
assets/taskmarket-*.png     brand lockup and mark
data/site.json              the cached snapshot the page reads
s/<chain>-<range>.html      static share pages with their own Open Graph tags
scripts/collect.mjs         server-side API collector
scripts/og.mjs              share-card renderer (Chrome, build time only)
scripts/share.mjs           share-page generator
deploy.sh                   one-command build and deploy
.github/workflows/refresh.yml  hourly collect, card render and Pages deploy
notes.txt                   submission notes for the bounty
```

## Constraints

- Read-only. There is no wallet connection, no transaction, no cookie, no
  localStorage, no analytics and no third-party request.
- All fonts and images are served from this repository.
- The footer states that this was made for a paid Taskmarket bounty and is not
  an official Taskmarket product.
- MIT licence.

## Refreshing

The workflow runs at :17 every hour. If a run fails, the last successful
deployment stays live and the page keeps its original "Data as of" time; the
header switches to **Stale** after two hours. No empty or partial snapshot is
deployed: the collector throws if either chain is missing tasks or the time
series.

## Licence

MIT. See `LICENSE`.
