#!/usr/bin/env node
/**
 * Taskmarket in the open: server-side data collector.
 *
 * Fetches the public Taskmarket API for Tempo (4217) and Base (8453), walks the
 * public task list, computes the market view, and writes one cached JSON file.
 *
 * No dependencies. Node 20+.
 *
 *   node scripts/collect.mjs [outfile]
 *
 * The browser never calls api.taskmarket.dev. GitHub Actions runs this hourly and
 * deploys the generated file with the static site.
 */

import fs from "node:fs";
import path from "node:path";

const BASE = "https://api.taskmarket.dev";
const RANGES = ["7d", "30d", "90d"];
const CHAINS = [
  { name: "tempo", chainId: 4217, label: "Tempo", token: "OUSD" },
  { name: "base", chainId: 8453, label: "Base", token: "USDC" },
];
const OUT = process.argv[2] || "data/site.json";
const MAX_PAGES = 60;
const PAGE_LIMIT = 100;
const REQUEST_TIMEOUT = 30_000;
const WEEK_COUNT = 10;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(...args) {
  console.error(`[collect ${new Date().toISOString()}]`, ...args);
}

async function getJson(pathname, tries = 6) {
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const started = Date.now();
    try {
      const response = await fetch(BASE + pathname, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const json = await response.json();
      log(`ok ${pathname} ${Date.now() - started}ms`);
      return json;
    } catch (error) {
      lastError = error;
      const wait = Math.min(12_000, 800 * attempt * attempt);
      log(`retry ${attempt}/${tries} ${pathname}: ${error.message}; waiting ${wait}ms`);
      if (attempt < tries) await sleep(wait);
    }
  }
  throw new Error(`failed ${pathname}: ${lastError?.message || "unknown"}`);
}

const amount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n / 1e6 : 0;
};

const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
};

const shortAddress = (address = "") =>
  address.length > 12 ? `${address.slice(0, 6)}\u2026${address.slice(-4)}` : address;

const firstLine = (text = "") =>
  String(text)
    .split(/\r?\n/, 1)[0]
    .replace(/\s+/g, " ")
    .trim();

const OUTCOME_BY_STATUS = {
  completed: "settled",
  open: "waiting",
  claimed: "waiting",
  worker_selected: "waiting",
  pending_approval: "waiting",
  cancelled: "cancelled",
  expired: "expired",
};

function weekStart(dateInput) {
  const date = new Date(dateInput);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function isoWeekLabel(weekStartDate) {
  const date = new Date(weekStartDate);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const isoDay = (date) => date.toISOString().slice(0, 10);

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function crawlTasks(chainId) {
  const tasks = [];
  const seen = new Set();
  let cursor = null;
  let pages = 0;
  let truncated = false;

  while (pages < MAX_PAGES) {
    const query =
      `/api/tasks?chainId=${chainId}&sort=newest&limit=${PAGE_LIMIT}` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const page = await getJson(query);
    const rows = Array.isArray(page.tasks) ? page.tasks : Array.isArray(page.items) ? page.items : [];
    for (const task of rows) {
      if (task?.id && !seen.has(task.id)) {
        seen.add(task.id);
        tasks.push(task);
      }
    }
    pages += 1;
    const next = page.nextCursor || null;
    log(`tasks chain=${chainId} page=${pages} got=${rows.length} total=${tasks.length} next=${next || "end"}`);
    if (!next || next === cursor || rows.length === 0) break;
    cursor = next;
    if (pages >= MAX_PAGES) {
      truncated = true;
      break;
    }
    await sleep(200);
  }

  return { tasks, pages, truncated };
}

function summariseTasks(tasks, now) {
  const totalReward = tasks.reduce((sum, task) => sum + amount(task.reward), 0);
  const rewards = tasks.map((task) => amount(task.reward));
  const outcomes = { settled: 0, waiting: 0, cancelled: 0, expired: 0 };
  const outcomeCounts = { settled: 0, waiting: 0, cancelled: 0, expired: 0 };
  const posterMap = new Map();
  const weekMap = new Map();

  for (const task of tasks) {
    const reward = amount(task.reward);
    const outcome = OUTCOME_BY_STATUS[task.status] || "expired";
    outcomes[outcome] += reward;
    outcomeCounts[outcome] += 1;

    const address = String(task.requester || "unknown").toLowerCase();
    if (!posterMap.has(address)) {
      posterMap.set(address, {
        address,
        short: shortAddress(address),
        tasks: 0,
        reward: 0,
        outcomes: { settled: 0, waiting: 0, cancelled: 0, expired: 0 },
        counts: { settled: 0, waiting: 0, cancelled: 0, expired: 0 },
      });
    }
    const poster = posterMap.get(address);
    poster.tasks += 1;
    poster.reward += reward;
    poster.outcomes[outcome] += reward;
    poster.counts[outcome] += 1;

    const start = weekStart(task.createdAt);
    const key = isoDay(start);
    if (!weekMap.has(key)) {
      weekMap.set(key, {
        start: key,
        week: isoWeekLabel(start),
        posters: new Set(),
        tasks: 0,
        reward: 0,
      });
    }
    const week = weekMap.get(key);
    week.posters.add(address);
    week.tasks += 1;
    week.reward += reward;
  }

  const posters = [...posterMap.values()].sort((a, b) => b.reward - a.reward);
  const top10Reward = posters.slice(0, 10).reduce((sum, poster) => sum + poster.reward, 0);
  const top2Reward = posters.slice(0, 2).reduce((sum, poster) => sum + poster.reward, 0);
  const ledger = posters.slice(0, 8).map((poster) => ({
    ...poster,
    reward: round(poster.reward),
    outcomes: Object.fromEntries(
      Object.entries(poster.outcomes).map(([key, value]) => [key, round(value)])
    ),
    share: totalReward ? round((poster.reward / totalReward) * 100, 1) : 0,
  }));
  const others = posters.slice(8).reduce(
    (acc, poster) => {
      acc.tasks += poster.tasks;
      acc.reward += poster.reward;
      for (const key of Object.keys(acc.outcomes)) {
        acc.outcomes[key] += poster.outcomes[key];
        acc.counts[key] += poster.counts[key];
      }
      return acc;
    },
    {
      tasks: 0,
      reward: 0,
      outcomes: { settled: 0, waiting: 0, cancelled: 0, expired: 0 },
      counts: { settled: 0, waiting: 0, cancelled: 0, expired: 0 },
    }
  );
  if (posters.length > 8) {
    ledger.push({
      address: "others",
      short: `${posters.length - 8} other posters`,
      tasks: others.tasks,
      reward: round(others.reward),
      outcomes: Object.fromEntries(
        Object.entries(others.outcomes).map(([key, value]) => [key, round(value)])
      ),
      counts: others.counts,
      share: totalReward ? round((others.reward / totalReward) * 100, 1) : 0,
    });
  }

  const currentWeekStart = weekStart(now);
  const weeks = [];
  for (let offset = WEEK_COUNT - 1; offset >= 0; offset--) {
    const start = new Date(currentWeekStart);
    start.setUTCDate(start.getUTCDate() - offset * 7);
    const key = isoDay(start);
    const found = weekMap.get(key);
    weeks.push({
      start: key,
      week: isoWeekLabel(start),
      posters: found ? found.posters.size : 0,
      tasks: found ? found.tasks : 0,
      reward: round(found ? found.reward : 0),
      partial: key === isoDay(currentWeekStart),
    });
  }

  const waitingTasks = tasks.filter((task) => OUTCOME_BY_STATUS[task.status] === "waiting");
  const waitingTotal = waitingTasks.reduce((sum, task) => sum + amount(task.reward), 0);
  const buckets = [
    { label: "<1h", max: 1 },
    { label: "1-6h", max: 6 },
    { label: "6-24h", max: 24 },
    { label: "1-3d", max: 72 },
    { label: "3-7d", max: 168 },
    { label: ">7d", max: Infinity },
  ].map((bucket) => ({ ...bucket, count: 0, reward: 0 }));

  const withAge = waitingTasks.map((task) => {
    const ageHours = Math.max(0, (now - new Date(task.createdAt)) / 3_600_000);
    const bucket = buckets.find((entry) => ageHours <= entry.max) || buckets[buckets.length - 1];
    bucket.count += 1;
    bucket.reward += amount(task.reward);
    return { task, ageHours };
  });

  withAge.sort((a, b) => b.ageHours - a.ageHours);

  return {
    totalReward: round(totalReward),
    outcomes: Object.fromEntries(Object.entries(outcomes).map(([key, value]) => [key, round(value)])),
    outcomeCounts,
    posterCount: posters.length,
    top2Share: totalReward ? round((top2Reward / totalReward) * 100, 1) : 0,
    top10Share: totalReward ? round((top10Reward / totalReward) * 100, 1) : 0,
    medianReward: round(median(rewards)),
    meanReward: round(totalReward / Math.max(1, tasks.length)),
    underOne: rewards.filter((reward) => reward < 1).length,
    underOneShare: tasks.length ? round((rewards.filter((reward) => reward < 1).length / tasks.length) * 100, 1) : 0,
    taskCount: tasks.length,
    weeklyPosters: weeks,
    ledger,
    escrow: {
      count: waitingTasks.length,
      total: round(waitingTotal),
      shareOfPosted: totalReward ? round((waitingTotal / totalReward) * 100, 1) : 0,
      buckets: buckets.map((bucket) => ({
        label: bucket.label,
        count: bucket.count,
        reward: round(bucket.reward),
      })),
      overWeek: {
        count: buckets[buckets.length - 1].count,
        reward: round(buckets[buckets.length - 1].reward),
      },
      oldest: withAge.slice(0, 3).map(({ task, ageHours }) => ({
        code: task.referenceCode || "",
        title: firstLine(task.description).slice(0, 96),
        ageHours: round(ageHours, 1),
        reward: round(amount(task.reward)),
        expiryTime: task.expiryTime || null,
      })),
    },
  };
}

function summariseSeries(buckets) {
  const rows = (Array.isArray(buckets) ? buckets : []).map((bucket) => ({
    date: bucket.bucket,
    tasks: Number(bucket.tasksCreated) || 0,
    activeAgents: Number(bucket.activeAgents) || 0,
    posted: round(amount(bucket.rewardVolume)),
    paid: round(amount(bucket.paidVolume)),
    settlements: Number(bucket.settlements) || 0,
    completed: Number(bucket.completedTasks) || 0,
    newAgents: Number(bucket.newAgents) || 0,
    ratings: Number(bucket.ratings) || 0,
  }));
  const totals = rows.reduce(
    (acc, row) => {
      acc.posted += row.posted;
      acc.paid += row.paid;
      acc.tasks += row.tasks;
      acc.settlements += row.settlements;
      acc.completed += row.completed;
      acc.newAgents += row.newAgents;
      return acc;
    },
    { posted: 0, paid: 0, tasks: 0, settlements: 0, completed: 0, newAgents: 0 }
  );
  const activeValues = rows.map((row) => row.activeAgents);
  return {
    buckets: rows,
    totals: {
      posted: round(totals.posted),
      paid: round(totals.paid),
      tasks: totals.tasks,
      settlements: totals.settlements,
      completed: totals.completed,
      newAgents: totals.newAgents,
      avgActiveAgents: rows.length
        ? Math.round(activeValues.reduce((sum, value) => sum + value, 0) / rows.length)
        : 0,
      peakActiveAgents: activeValues.length ? Math.max(...activeValues) : 0,
    },
  };
}

function summariseHeatmap(raw) {
  const cells = (Array.isArray(raw?.cells) ? raw.cells : []).map((cell) => ({
    row: String(cell.row),
    col: String(cell.col),
    count: Number(cell.count) || 0,
    volume: round(amount(cell.volume)),
  }));
  const peak = cells.reduce(
    (best, cell) => (cell.count > best.count ? cell : best),
    { row: "0", col: "0", count: 0, volume: 0 }
  );
  return {
    rowKeys: (raw?.rowKeys || ["0", "1", "2", "3", "4", "5", "6"]).map(String),
    colKeys: (raw?.colKeys || Array.from({ length: 24 }, (_, index) => String(index))).map(String),
    cells,
    max: peak.count,
    peak,
  };
}

function trimFeed(raw) {
  const items = (Array.isArray(raw?.items) ? raw.items : []).slice(0, 24);
  return items.map((item) => ({
    type: item.type || "event",
    timestamp: item.timestamp || null,
    taskId: item.taskId || null,
    chainId: item.chainId || null,
    taskTitle: String(item.taskTitle || "").slice(0, 160),
    actor: item.actor || null,
    actorType: item.actorType || null,
    agentId: item.agentId || item.actorAgentId || null,
    amount: item.amount == null ? null : round(amount(item.amount)),
  }));
}

function normaliseBreakdowns(raw) {
  const pick = (key) =>
    (Array.isArray(raw?.[key]) ? raw[key] : []).map((row) => ({
      key: row[key],
      count: Number(row.count) || 0,
    }));
  return {
    status: pick("status"),
    mode: pick("mode"),
    actorType: pick("actorType"),
  };
}

async function fetchMarket(chain) {
  log(`chain=${chain.name} (${chain.chainId}) market start`);
  const [stats, breakdownsRaw, ...rest] = await Promise.all([
    getJson(`/api/market/stats?chainId=${chain.chainId}`),
    getJson(`/api/stats/breakdowns?chainId=${chain.chainId}`),
    ...RANGES.flatMap((range) => [
      getJson(`/api/stats/platform-time-series?chainId=${chain.chainId}&range=${range}&bucket=day`),
      getJson(`/api/stats/activity-heatmap?chainId=${chain.chainId}&range=${range}&dimension=hourOfWeek`),
    ]),
    getJson(`/api/stats/activity-feed?chainId=${chain.chainId}&limit=24`),
  ]);

  const series = {};
  const heatmaps = {};
  let index = 0;
  for (const range of RANGES) {
    series[range] = summariseSeries(rest[index]);
    index += 1;
    heatmaps[range] = summariseHeatmap(rest[index]);
    index += 1;
  }
  const feedRaw = rest[index];

  return {
    stats: {
      registeredWorkers: Number(stats.registeredWorkers) || 0,
      activeWorkers7d: Number(stats.activeWorkers7d) || 0,
      activeAgents7d: Number(stats.activeAgents7d) || 0,
      openTasks: Number(stats.openTasks) || 0,
      paidWorkers: Number(stats.paidWorkers) || 0,
      activeWallets: Number(stats.activeWallets) || 0,
    },
    breakdowns: normaliseBreakdowns(breakdownsRaw),
    series,
    heatmaps,
    feed: trimFeed(feedRaw),
  };
}

async function collectChain(chain, market, now) {
  log(`chain=${chain.name} (${chain.chainId}) task list start`);
  const crawl = await crawlTasks(chain.chainId);
  const summary = summariseTasks(crawl.tasks, now);

  return {
    name: chain.name,
    chainId: chain.chainId,
    label: chain.label,
    token: chain.token,
    ...market,
    tasks: {
      scanned: crawl.tasks.length,
      pages: crawl.pages,
      truncated: crawl.truncated,
    },
    ...summary,
  };
}

// The market endpoints are called for both chains at the same moment. Some of
// them currently return one platform-wide total for either chainId; others may
// one day return real per-chain data. Compare with a small tolerance because
// the live edge (today's bucket, the newest events) moves between requests.
const within = (a, b, relative = 0.01, absolute = 2) =>
  Math.abs(a - b) <= Math.max(absolute, Math.max(Math.abs(a), Math.abs(b)) * relative);

function seriesSame(a, b) {
  return RANGES.every((range) => {
    const left = a.series?.[range]?.buckets || [];
    const right = b.series?.[range]?.buckets || [];
    if (left.length !== right.length || left.length < 2) return false;
    // Ignore the last bucket: it is the live, partial day.
    for (let index = 0; index < left.length - 1; index++) {
      if (JSON.stringify(left[index]) !== JSON.stringify(right[index])) return false;
    }
    return true;
  });
}

function heatmapSame(a, b) {
  return RANGES.every((range) => {
    const left = a.heatmaps?.[range]?.cells || [];
    const right = b.heatmaps?.[range]?.cells || [];
    if (!left.length || !right.length) return false;
    const map = new Map(right.map((cell) => [`${cell.row}:${cell.col}`, cell.count]));
    let difference = 0;
    let total = 0;
    for (const cell of left) {
      difference += Math.abs(cell.count - (map.get(`${cell.row}:${cell.col}`) || 0));
      total += cell.count;
      map.delete(`${cell.row}:${cell.col}`);
    }
    for (const value of map.values()) {
      difference += value;
      total += value;
    }
    return total > 0 && difference / total <= 0.01;
  });
}

function breakdownsSame(a, b) {
  for (const group of ["status", "mode", "actorType"]) {
    const left = new Map((a[group] || []).map((row) => [row.key, row.count]));
    const right = new Map((b[group] || []).map((row) => [row.key, row.count]));
    const keys = new Set([...left.keys(), ...right.keys()]);
    for (const key of keys) {
      if (!within(left.get(key) || 0, right.get(key) || 0, 0.01, 3)) return false;
    }
  }
  return true;
}

function statsSame(a, b) {
  return ["openTasks", "activeAgents7d", "activeWorkers7d"].every((key) =>
    within(Number(a?.[key]) || 0, Number(b?.[key]) || 0, 0.01, 2)
  );
}

function computeScopes(chains) {
  const feedSimilar = (a, b) => {
    if (!a.length || !b.length) return false;
    const ids = new Set(a.map((item) => item.taskId));
    const overlap = b.filter((item) => ids.has(item.taskId)).length;
    return overlap / Math.min(a.length, b.length) >= 0.6;
  };
  const tempo = chains.tempo;
  const base = chains.base;
  return {
    series: seriesSame(tempo, base) ? "platform" : "chain",
    heatmap: heatmapSame(tempo, base) ? "platform" : "chain",
    feed: feedSimilar(tempo.feed || [], base.feed || []) ? "platform" : "chain",
    breakdowns: breakdownsSame(tempo, base) ? "platform" : "chain",
    stats: statsSame(tempo.stats, base.stats) ? "platform" : "chain",
  };
}

async function main() {
  const now = new Date();

  if (process.argv.includes("--scopes-only")) {
    const target = path.resolve(OUT);
    const snapshot = JSON.parse(fs.readFileSync(target, "utf8"));
    snapshot.scopes = computeScopes(snapshot.chains);
    const temp = `${target}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(snapshot));
    fs.renameSync(temp, target);
    log(`scopes refreshed ${JSON.stringify(snapshot.scopes)}`);
    return;
  }
  log(`start ${now.toISOString()} -> ${OUT}`);
  const markets = await Promise.all(CHAINS.map((chain) => fetchMarket(chain)));
  const chains = {};
  for (let index = 0; index < CHAINS.length; index++) {
    const chain = CHAINS[index];
    chains[chain.name] = await collectChain(chain, markets[index], now);
  }

  for (const [name, chain] of Object.entries(chains)) {
    if (!chain.tasks.scanned) throw new Error(`no tasks collected for ${name}`);
    if (!chain.series["30d"].buckets.length) throw new Error(`no time series for ${name}`);
  }

  const scopes = computeScopes(chains);

  const site = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: BASE,
    refresh: "hourly",
    scopes,
    chains,
  };

  const outPath = path.resolve(OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tempPath = `${outPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(site));
  fs.renameSync(tempPath, outPath);
  const size = fs.statSync(outPath).size;
  log(`wrote ${outPath} ${(size / 1024).toFixed(1)} KiB`);
  for (const [name, chain] of Object.entries(chains)) {
    log(
      `${name}: ${chain.tasks.scanned} tasks, ${chain.posterCount} posters, ` +
        `${chain.totalReward} ${chain.token} posted, ${chain.escrow.count} waiting`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
