#!/usr/bin/env node
/**
 * Generate the per-view share pages in s/.
 *
 *   node scripts/share.mjs
 *
 * X and LinkedIn do not run JavaScript and cannot read a #hash view, so each
 * view gets a small static HTML page with its own Open Graph tags and image.
 * It redirects a human to the exact dashboard view.
 *
 * Set SITE_URL to override the default public base URL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "data/site.json");
const OUT_DIR = path.join(ROOT, "s");
const BASE_URL = (process.env.SITE_URL || "https://sc0d3r.github.io/taskmarket-pulse").replace(/\/$/, "");
const CHAINS = ["tempo", "base"];
const RANGES = ["7d", "30d", "90d"];
const RANGE_LABELS = { "7d": "last 7 days", "30d": "last 30 days", "90d": "last 90 days" };

const site = JSON.parse(fs.readFileSync(SITE, "utf8"));
if (!site?.chains?.tempo || !site?.chains?.base) {
  throw new Error("data/site.json is missing a chain; run scripts/collect.mjs first");
}

const intFmt = new Intl.NumberFormat("en-US");
const twoFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const asOf = new Date(site.generatedAt).toLocaleString("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const chain of CHAINS) {
  for (const range of RANGES) {
    const data = site.chains[chain];
    const series = data.series[range];
    const platformScope = site.scopes?.series === "platform" ? "All chains" : data.label;
    const viewUrl = `${BASE_URL}/#${chain}/${range}`;
    const pageUrl = `${BASE_URL}/s/${chain}-${range}.html`;
    const imageUrl = `${BASE_URL}/assets/og/${chain}-${range}.png`;
    const title = `${data.label}: ${intFmt.format(Math.round(Number(data.totalReward) || 0))} ${
      data.token
    } posted, all time`;
    const description =
      `${intFmt.format(data.posterCount)} posters, ${intFmt.format(data.taskCount)} public tasks and ` +
      `${intFmt.format(data.escrow?.count || 0)} waiting in escrow on ${data.label}. ` +
      `${platformScope}, ${RANGE_LABELS[range]}: ${twoFmt.format(series.totals.posted)} USD posted, ` +
      `${twoFmt.format(series.totals.paid)} USD paid. Data as of ${asOf} UTC.`;

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(viewUrl)}">
<meta http-equiv="refresh" content="0; url=../#${chain}/${range}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Taskmarket in the open">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${esc(imageUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(
      `${data.label} public task list: ${intFmt.format(Math.round(Number(data.totalReward) || 0))} ${
        data.token
      } posted across ${intFmt.format(data.taskCount)} tasks, split by settled, waiting, cancelled and expired.`
    )}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(imageUrl)}">
<meta name="theme-color" content="#12100E">
</head>
<body style="margin:0;background:#12100E;color:#EFE9E2;font-family:system-ui,sans-serif;padding:32px">
<p style="max-width:60ch;line-height:1.5">Opening <a href="../#${chain}/${range}" style="color:#D9A097">${esc(
      `${data.label}, ${RANGE_LABELS[range]}`
    )}</a> in the Taskmarket in the open dashboard.</p>
<script>location.replace("../#${chain}/${range}");</script>
</body>
</html>
`;
    fs.writeFileSync(path.join(OUT_DIR, `${chain}-${range}.html`), html);
  }
}

console.log(`wrote ${CHAINS.length * RANGES.length} share pages for ${BASE_URL}`);
