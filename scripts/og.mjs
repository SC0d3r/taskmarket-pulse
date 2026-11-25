#!/usr/bin/env node
/**
 * Render the share cards, one per view, from the cached snapshot.
 *
 *   node scripts/og.mjs
 *
 * Needs Google Chrome (or CHROME_BIN) at build time only. The deployed site is
 * static; no browser is needed to view it. Output: assets/og/<chain>-<range>.png
 *
 * Cards are 1200x630, brand fonts and colours only. The headline number is the
 * chain's public task list (all tasks). The platform line uses the same
 * platform-wide series that the dashboard shows for the chosen range.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "data/site.json");
const OUT_DIR = path.join(ROOT, "assets/og");
const CHAINS = ["tempo", "base"];
const RANGES = ["7d", "30d", "90d"];
const RANGE_LABELS = { "7d": "last 7 days", "30d": "last 30 days", "90d": "last 90 days" };

const site = JSON.parse(fs.readFileSync(SITE, "utf8"));
if (!site?.chains?.tempo || !site?.chains?.base) {
  throw new Error("data/site.json is missing a chain; run scripts/collect.mjs first");
}

const intFmt = new Intl.NumberFormat("en-US");
const twoFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (value) => `${(Number(value) || 0).toFixed(1)}%`;
const asOf = new Date(site.generatedAt)
  .toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  })
  .toUpperCase();

const fileUrl = (relative) => `file://${path.join(ROOT, relative)}`;

function cardHtml(chain, range) {
  const data = site.chains[chain];
  const series = data.series[range];
  const outcomes = data.outcomes || {};
  const total = Number(data.totalReward) || 0;
  const share = (key) => (total ? Math.max(0, (Number(outcomes[key]) || 0) / total) * 100 : 0);
  const platformScope = site.scopes?.series === "platform" ? "All chains" : data.label;
  const median = Number(data.medianReward) || 0;
  const escrow = data.escrow || {};
  const overWeek = escrow.overWeek || {};

  const segments = ["settled", "waiting", "cancelled", "expired"]
    .map((key) => `<span class="${key}" style="width:${share(key).toFixed(3)}%"></span>`)
    .join("");

  const legend = [
    ["settled", "Settled"],
    ["waiting", "Waiting"],
    ["cancelled", "Cancelled"],
    ["expired", "Expired"],
  ]
    .map(
      ([key, label]) =>
        `<span><i class="${key}"></i>${label} ${pct(share(key))}</span>`
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Share card</title>
<style>
@font-face{font-family:"Instrument Serif";src:url("${fileUrl("assets/fonts/InstrumentSerif-Regular.ttf")}") format("truetype");font-weight:400;font-style:normal}
@font-face{font-family:"Instrument Serif";src:url("${fileUrl("assets/fonts/InstrumentSerif-Italic.ttf")}") format("truetype");font-weight:400;font-style:italic}
@font-face{font-family:"Departure Mono";src:url("${fileUrl("assets/fonts/DepartureMono-Regular.woff2")}") format("woff2");font-weight:400;font-style:normal}
*{box-sizing:border-box}
html,body{margin:0}
body{width:1200px;height:630px;overflow:hidden;background:#12100E;color:#EFE9E2;font-family:"Instrument Serif",Georgia,serif;position:relative}
.glow{position:absolute;inset:0;background:radial-gradient(760px 480px at 88% -12%,rgba(58,20,32,.98),transparent 66%),radial-gradient(540px 380px at -6% 110%,rgba(58,20,32,.55),transparent 62%)}
.card{position:relative;display:flex;flex-direction:column;height:100%;padding:42px 52px 32px}
.top{display:flex;justify-content:space-between;align-items:center;padding-bottom:16px;border-bottom:1px solid rgba(69,62,55,.85)}
.top img{display:block;height:30px;width:auto}
.asof{font-family:"Departure Mono",monospace;font-size:13px;letter-spacing:.06em;color:#D8CCC0;text-transform:uppercase}
.eyebrow{display:flex;justify-content:space-between;align-items:baseline;margin-top:16px;font-family:"Departure Mono",monospace;font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#B0A79D}
.eyebrow b{color:#EFE9E2;font-weight:400}
h1{margin:12px 0 0;font-family:"Instrument Serif",Georgia,serif;font-weight:400;font-size:100px;line-height:.93;letter-spacing:-.022em;color:#FFF6E8;white-space:nowrap}
h1 .unit{margin-left:.16em}
h1 em{font-style:italic;color:#E74079;margin-left:.07em}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 392px;gap:34px;align-items:start;margin-top:18px}
.sub{margin:0;font-size:24px;line-height:1.34;color:#B0A79D;font-weight:400;max-width:54ch}
.sub b{color:#EFE9E2;font-weight:400}
.chain-note{margin:8px 0 0;font-family:"Departure Mono",monospace;font-size:10.5px;line-height:1.55;letter-spacing:.02em;color:#8F857B;max-width:54ch}
.insight{margin:10px 0 0;font-family:"Departure Mono",monospace;font-size:10.5px;line-height:1.6;color:#9A8F84;max-width:56ch}
.insight b{color:#EFE9E2;font-weight:400}
.escrow{margin:7px 0 0;font-family:"Departure Mono",monospace;font-size:10.5px;line-height:1.6;color:#9A8F84;max-width:56ch}
.escrow b{color:#EFE9E2;font-weight:400}
.panel{padding:14px 16px 12px;background:rgba(34,30,26,.86);border:1px solid #5A4C42;border-radius:10px}
.panel-kicker{font-family:"Departure Mono",monospace;font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;color:#EFE9E2}
.panel-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:3px 0 8px;font-family:"Departure Mono",monospace;font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:#A79C90}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:14px;padding:5px 0;border-bottom:1px solid rgba(69,62,55,.4);font-family:"Departure Mono",monospace}
.row:last-of-type{border-bottom:0}
.row .k{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#9A8F84;white-space:nowrap}
.row .v{font-size:18px;color:#FFF6E8;white-space:nowrap}
.row .v small{display:inline-block;min-width:30px;text-align:left;font-size:9px;color:#B0A79D;margin-left:5px;letter-spacing:.03em}
.row .v small.perday{min-width:0;margin-left:1px}
.panel-note{margin:7px 0 0;font-family:"Departure Mono",monospace;font-size:9.5px;line-height:1.45;color:#9A8F84}
.bar-wrap{margin-top:auto;padding-top:20px}
.bar-title{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:8px;font-family:"Departure Mono",monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#8F857B}
.bar-title b{color:#EFE9E2;font-weight:400}
.bar{display:flex;height:13px;border-radius:3px;overflow:hidden;background:#221E1A;box-shadow:inset 0 0 0 1px rgba(69,62,55,.7)}
.bar span{height:100%;box-shadow:inset -2px 0 0 #12100E}
.bar span:last-child{box-shadow:none}
.bar .settled,.legend i.settled{background:#D9A097}
.bar .waiting,.legend i.waiting{background:#C2A06B}
.bar .cancelled,.legend i.cancelled{background:#8F4A3F}
.bar .expired,.legend i.expired{background:#6B6058}
.legend{display:flex;justify-content:space-between;gap:14px;margin-top:9px;font-family:"Departure Mono",monospace;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:#B0A79D}
.legend span{display:inline-flex;align-items:center;white-space:nowrap}
.legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:7px}
.foot{display:flex;justify-content:space-between;align-items:baseline;margin-top:18px;padding-top:12px;border-top:1px solid rgba(69,62,55,.85);font-family:"Departure Mono",monospace;font-size:10.5px;letter-spacing:.05em;color:#8F857B;text-transform:uppercase;gap:20px}
.foot b{color:#EFE9E2;font-weight:400}
.foot .url{text-transform:none;letter-spacing:.02em}
</style></head>
<body><div class="glow"></div><div class="card">
  <div class="top">
    <img src="${fileUrl("assets/taskmarket-lockup.png")}" alt="Taskmarket">
    <span class="asof">Data as of ${asOf} UTC</span>
  </div>
  <div class="eyebrow"><span><b>${data.label}</b> public task list &middot; all time</span><span>${data.token}</span></div>
  <h1>${intFmt.format(Math.round(total))}<span class="unit">${data.token}</span> <em>posted</em></h1>
  <div class="grid">
    <div>
      <p class="sub"><b>${intFmt.format(data.posterCount)}</b> posters &middot; <b>${intFmt.format(data.taskCount)}</b> public tasks &middot; <b>${intFmt.format(escrow.count || 0)}</b> waiting</p>
      <p class="chain-note">Every task in this chain's public task list since launch. Amounts in ${data.token}.</p>
      <p class="insight">The top ten posters hold <b>${pct(data.top10Share)}</b> of all rewards. Median task <b>${twoFmt.format(median)} ${data.token}</b>; <b>${pct(data.underOneShare)}</b> of tasks carry less than 1 ${data.token}.</p>
      <p class="escrow"><b>${intFmt.format(escrow.count || 0)}</b> waiting tasks hold <b>${twoFmt.format(escrow.total || 0)} ${data.token}</b>, ${pct(escrow.shareOfPosted)} of rewards. <b>${intFmt.format(overWeek.count || 0)}</b> have waited over a week.</p>
    </div>
    <div class="panel">
      <div class="panel-kicker">Platform-wide &middot; ${platformScope}</div>
      <div class="panel-head"><span>${RANGE_LABELS[range]}</span><span>USD</span></div>
      <div class="row"><span class="k">Rewards posted</span><span class="v">${twoFmt.format(series.totals.posted)}<small>USD</small></span></div>
      <div class="row"><span class="k">Rewards paid</span><span class="v">${twoFmt.format(series.totals.paid)}<small>USD</small></span></div>
      <div class="row"><span class="k">Tasks posted</span><span class="v">${intFmt.format(series.totals.tasks)}<small>&nbsp;</small></span></div>
      <div class="row"><span class="k">Avg active agents</span><span class="v">${intFmt.format(series.totals.avgActiveAgents)}<small class="perday">/day</small></span></div>
      <p class="panel-note">Money in USD: OUSD and USDC both track one dollar. Posted is new escrow in the window; paid includes older escrow that settled.</p>
    </div>
  </div>
  <div class="bar-wrap">
    <div class="bar-title"><span><b>${data.label}</b> task list &middot; share of rewards by outcome</span><span>All time</span></div>
    <div class="bar" role="img" aria-label="Share of rewards by outcome">${segments}</div>
    <div class="legend">${legend}</div>
  </div>
  <div class="foot"><span><b>taskmarket.dev</b> &middot; taskmarket in the open &middot; not an official Taskmarket product</span><span class="url">sc0d3r.github.io/taskmarket-pulse</span></div>
</div></body></html>`;
}

function findChrome() {
  const candidates = [process.env.CHROME_BIN, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // try the next one
    }
  }
  throw new Error("no Chrome binary found; set CHROME_BIN");
}

const chrome = findChrome();
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
} catch {
  throw new Error("ffmpeg is required to crop the 1200x630 card out of the tall screenshot");
}
fs.mkdirSync(OUT_DIR, { recursive: true });
const tempFiles = [];

for (const chain of CHAINS) {
  for (const range of RANGES) {
    const htmlPath = path.join(ROOT, "scripts", `.card-${chain}-${range}.html`);
    const pngPath = path.join(OUT_DIR, `${chain}-${range}.png`);
    fs.writeFileSync(htmlPath, cardHtml(chain, range));
    tempFiles.push(htmlPath);
    const shotPath = path.join(ROOT, "scripts", `.card-${chain}-${range}.shot.png`);
    try {
      // New headless Chrome subtracts ~88px of window chrome from --window-size, so a
      // 1200x630 window yields a 542px viewport and clips the legend and footer.
      // Render tall, then crop the top 1200x630 with ffmpeg.
      execFileSync(
        chrome,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-sandbox",
          "--hide-scrollbars",
          "--force-device-scale-factor=1",
          "--run-all-compositor-stages-before-draw",
          "--virtual-time-budget=3000",
          "--window-size=1200,900",
          `--screenshot=${shotPath}`,
          `file://${htmlPath}`,
        ],
        { stdio: ["ignore", "ignore", "pipe"] }
      );
      execFileSync(
        "ffmpeg",
        ["-y", "-loglevel", "error", "-i", shotPath, "-vf", "crop=1200:630:0:0", "-frames:v", "1", pngPath],
        { stdio: ["ignore", "ignore", "pipe"] }
      );
      const size = fs.statSync(pngPath).size;
      console.log(`${chain}-${range}: ${(size / 1024).toFixed(1)} KiB`);
    } finally {
      fs.rmSync(shotPath, { force: true });
      if (!process.env.KEEP_CARD_HTML) fs.rmSync(htmlPath, { force: true });
    }
  }
}
