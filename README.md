# Fitness Dashboard

A static website that turns the **Ravi Fitness – Sleep, Workouts & Food** Google Sheet into dashboards:

| Page | What it shows |
|---|---|
| **Training** | Highlights carousel (animated swim/bike/run cards, photos from `data/photos.json` when added), then Weekly hours by sport, sport mix, activity calendar, totals, filterable workout log |
| **Overview** | This week vs last week (sleep, score, protein, intake, training, weight), auto-generated insights, race countdowns |
| **Nutrition** | Calories vs FITTR target, protein vs 140 g, macro split, calories by time of day, weekly averages, top foods |
| **Sleep** | Time asleep vs 7 h, stages, score labels, HRV trend, bedtime vs score, nightly table |
| **Body** | Weight trend vs goal (DailyStats + historical weigh-ins), profile/DEXA, weight by year |
| **BP** | Blood pressure from *Health Historical Daily* (2021–): average and AHA category, trend vs 130/80, days per category, year by year, weight vs BP |
| **History** | Every day since 2013 from *Health Historical Daily*: monthly weight, steps and sleep, long-term patterns, year-by-year table |
| **Races** | Upcoming races with countdown, completed per year, full history |
| **Insights** | The so-what layer: top 3 actions, red/amber/green scorecard (sleep, protein, calories, weight, training, run volume for the next marathon, strength, steps, BP, late-night eating) with Keep / Improve / Accelerate / Ease off, plus sleep→training and calories→weight links |

Every page has a 7d / 30d / 90d / All range, dark mode, and sortable tables. No build step: plain HTML, CSS and JavaScript ([Chart.js](https://www.chartjs.org/) + [PapaParse](https://www.papaparse.com/) from a CDN).

## How the data flows

```
Google Sheet ──(Publish to web, CSV)──► browser reads it live on every page load
      │                                        │ if the sheet can't be reached
      └──(GitHub Action, daily)──► /data/*.csv ◄┘ snapshot is used instead
                                    (every change is a git commit = version history)
```

## Setup

### 1. Turn on live data
1. In the sheet: **File → Share → Publish to web** → *Entire document* → *Comma-separated values (.csv)* → **Publish**.
2. Copy the link. It looks like `https://docs.google.com/spreadsheets/d/e/2PACX-…/pub?output=csv`. Paste the `2PACX-…` part into `publishedId` in [`js/config.js`](js/config.js).
3. For each tab you want live, click the tab in Sheets and copy the number after `#gid=` in the URL into that tab's `gid` in `js/config.js`.

Until this is done the site runs on the snapshot in `/data` (it shows "Snapshot" in the header; "Live from Google Sheet" once connected).

> **Privacy:** "Publish to web" makes those tabs readable by anyone who has (or guesses) the link. If that's not OK, skip step 1 and refresh the snapshot by hand instead.

### 2. Host it
- **GitHub Pages:** repo **Settings → Pages → Deploy from a branch → `main` / root**. Free accounts need the repo to be **public** for Pages, which makes `/data` public too.
- **Private alternative:** keep the repo private and connect it to [Cloudflare Pages](https://pages.cloudflare.com/) or [Netlify](https://www.netlify.com/) (both free; add their access protection if you want a login).

### 3. Daily snapshots
`.github/workflows/snapshot.yml` runs every morning (and on demand from the **Actions** tab), saves each published tab into `/data`, and commits only when something changed. Browse a file's **History** on GitHub to see or restore any earlier version.

Run it locally with `node scripts/snapshot.mjs` (Node 18+).

## Run locally
```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
(Opening `index.html` directly won't load the CSVs; browsers block that.)

## Privacy
The site's copies of the data are cleaned by `scripts/sanitize.py` (and the same rules in `scripts/snapshot.mjs`): registration/confirmation numbers, costs and race notes are removed, Summary rows with payment or reference details are dropped, and sold-out races are left out. *racelist* and *Summary* are never read live from the published sheet. The Google Sheet keeps everything.

## Merge rules
- **Weight:** *Health Historical Daily* fills the history; *DailyStats* wins for any date it has.
- **Sleep:** the Garmin *Sleep* tab wins for any night it has; older nights come from *Health Historical Daily*.
- **Steps:** *Health Historical Daily* only.
- **Blood pressure:** *Health Historical Daily* only (each day's average reading).

## Customising
- **Targets** (2,004 kcal, 140 g protein, 7 h sleep, 160 lb goal…): `targets` in `js/config.js`.
- **Sheet layout:** parsers in `js/data.js` find each tab's header row by its first cell (`Date`), carry dates down to blank-date rows (Workouts, Food Log), and read numbers out of text like `1,251 (Strava)` or `1:14:36 (moving)`. If you rename or reorder columns in a tab, update the matching parser.
- **Charts/pages:** `js/app.js`, one `render…()` function per page.

## Files
```
index.html            page shell
css/style.css         styles (light + dark)
js/config.js          sheet IDs, tab gids, targets
js/data.js            fetching + parsing each tab
js/app.js             pages, charts, insights
data/*.csv            snapshot of each tab (fallback + history)
scripts/xlsx2csv.py   turn an .xlsx export of the sheet into the /data CSVs
scripts/snapshot.mjs  downloads tabs into /data
.github/workflows/    daily snapshot job
```
