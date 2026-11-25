/* Taskmarket in the open: client-side renderer.
   Loads one server-generated JSON snapshot. No API calls, no cookies, no tracking. */

(() => {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const CHAINS = ["tempo", "base"];
  const RANGES = ["7d", "30d", "90d"];
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const RANGE_LABELS = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" };
  const OUTCOMES = ["settled", "waiting", "cancelled", "expired"];

  const state = { data: null, chain: "tempo", range: "30d" };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const intFmt = new Intl.NumberFormat("en-US");
  const moneyFmt = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const oneFmt = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });

  const fmtInt = (value) => intFmt.format(Math.round(Number(value) || 0));
  const fmtMoney = (value) => moneyFmt.format(Number(value) || 0);
  const fmtOne = (value) => oneFmt.format(Number(value) || 0);
  const pct = (value, digits = 1) => `${(Number(value) || 0).toFixed(digits)}%`;

  const esc = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const shortAddress = (address) => {
    const value = String(address || "");
    return value.length > 12 ? `${value.slice(0, 6)}\u2026${value.slice(-4)}` : value;
  };

  const token = () => state.data?.chains?.[state.chain]?.token || "";
  const chainData = () => state.data?.chains?.[state.chain];
  const isPlatform = (key) => state.data?.scopes?.[key] === "platform";
  const scopeOf = (key) => (isPlatform(key) ? "All chains" : chainData()?.label || "");
  const unitFor = (key) => (isPlatform(key) ? "USD" : chainData()?.token || "");

  function readHash() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [chain, range] = raw.split("/");
    if (CHAINS.includes(chain)) state.chain = chain;
    if (RANGES.includes(range)) state.range = range;
  }

  function writeHash() {
    const next = `#${state.chain}/${state.range}`;
    if (location.hash !== next) {
      history.replaceState(null, "", next);
    }
  }

  function formatDateShort(iso) {
    if (!iso) return "";
    const date = new Date(`${iso}T00:00:00Z`);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }

  function formatWeekShort(week) {
    return week ? String(week).replace(/^\d{4}-/, "") : "";
  }

  function formatDateTime(iso) {
    if (!iso) return "loading";
    const date = new Date(iso);
    return `${date.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    })} UTC`;
  }

  function formatTime(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    return date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
  }

  function humanize(value) {
    return String(value || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function svgEl(name, attrs = {}, text) {
    const element = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined && value !== null) element.setAttribute(key, String(value));
    }
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function svgRoot(host, width, height, label) {
    host.innerHTML = "";
    const svg = svgEl("svg", {
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": label,
      preserveAspectRatio: "none",
    });
    host.appendChild(svg);
    return svg;
  }

  function getWidth(host, fallback = 800) {
    const width = host.clientWidth;
    return width > 40 ? width : fallback;
  }

  function getHeight(host, fallback = 320) {
    const height = host.clientHeight;
    return height > 40 ? height : fallback;
  }

  function showError(error) {
    let banner = $("#load-error");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "load-error";
      banner.className = "error-banner";
      banner.setAttribute("role", "alert");
      const hero = $(".hero");
      hero?.insertAdjacentElement("afterend", banner);
    }
    banner.innerHTML = `Could not load the market snapshot (${esc(error?.message || "unknown error")}). The last deployment may still be updating. <button class="text-btn" type="button" id="retry">Retry</button>`;
    $("#retry")?.addEventListener("click", () => {
      banner.remove();
      load();
    });
  }

  async function load() {
    try {
      const response = await fetch("data/site.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data?.chains?.tempo || !data?.chains?.base) throw new Error("snapshot is missing a chain");
      for (const chain of CHAINS) {
        for (const range of RANGES) {
          if (!data.chains[chain].series?.[range]?.buckets?.length) {
            throw new Error(`snapshot is missing ${chain} ${range}`);
          }
        }
      }
      state.data = data;
      renderAll();
    } catch (error) {
      console.error(error);
      showError(error);
    }
  }

  function renderAll() {
    const cd = chainData();
    if (!cd) return;

    $$("[data-chain]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.chain === state.chain));
    });
    $$("[data-range]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.range === state.range));
    });

    const generated = new Date(state.data.generatedAt);
    const ageHours = (Date.now() - generated.getTime()) / 3_600_000;
    const stale = ageHours > 2;
    $("#live")?.classList.toggle("stale", stale);
    const liveLabel = $("#live-label");
    if (liveLabel) liveLabel.textContent = stale ? "Stale" : "Live";
    const asof = formatDateTime(state.data.generatedAt);
    $("#asof").textContent = asof;
    $$(".js-asof").forEach((element) => {
      element.textContent = asof;
    });

    const rangeLabel = RANGE_LABELS[state.range].toLowerCase();
    $("#flow-meta").textContent = `${scopeOf("series")}, ${rangeLabel}`;
    $("#heat-meta").textContent = `${scopeOf("heatmap")}, ${rangeLabel}`;
    $("#tape-meta").textContent = scopeOf("feed");
    $("#mix-meta").textContent = scopeOf("breakdowns");
    $("#ledger-meta").textContent = `${cd.label} task list`;
    $("#waiting-meta").textContent = `${cd.label}, right now`;
    $("#posters-meta").textContent = `${cd.label}, last 10 weeks`;
    const mixDesc = $("#mix-desc");
    if (mixDesc) {
      mixDesc.textContent = isPlatform("breakdowns")
        ? "Counts by mode and status. The breakdowns endpoint returns one market total for both chain IDs in this snapshot, so this panel is not split by chain."
        : `Counts by mode and status on ${cd.label}.`;
    }

    renderStats(cd);
    renderLedger(cd);
    renderTimeline(cd);
    renderEscrow(cd);
    renderPosters(cd);
    renderMix(cd);
    renderHeatmap(cd);
    renderFeed(cd);
    document.title = `Taskmarket in the open: ${cd.label}, ${RANGE_LABELS[state.range].toLowerCase()}`;
  }

  function renderStats(cd) {
    const totals = cd.series[state.range].totals;
    const unit = unitFor("series");
    const seriesScope = `${scopeOf("series")}, ${RANGE_LABELS[state.range].toLowerCase()}`;
    const liveScope = isPlatform("stats") ? "all chains, right now" : `${cd.label}, right now`;
    const agentScope = isPlatform("stats") ? "all chains, 7 days" : `${cd.label}, 7 days`;
    const ratio = totals.posted ? (totals.paid / totals.posted) * 100 : 0;
    const ratioNote =
      totals.paid > totals.posted
        ? "Older escrow settled in this window"
        : "Share of new escrow that left for winners";

    const stats = [
      {
        label: "Rewards posted",
        scope: seriesScope,
        value: fmtMoney(totals.posted),
        unit,
        note: `${fmtInt(totals.tasks)} tasks posted in the window`,
      },
      {
        label: "Rewards paid",
        scope: seriesScope,
        value: fmtMoney(totals.paid),
        unit,
        note: `${fmtInt(totals.settlements)} settlements in the window`,
      },
      {
        label: "Paid per posted",
        scope: seriesScope,
        value: pct(ratio),
        unit: "",
        note: ratioNote,
      },
      {
        label: "Open tasks",
        scope: liveScope,
        value: fmtInt(cd.stats.openTasks),
        unit: "",
        note: "Open on the market now",
      },
      {
        label: "Active agents",
        scope: agentScope,
        value: fmtInt(cd.stats.activeAgents7d),
        unit: "",
        note: `${fmtInt(cd.stats.activeWorkers7d)} active workers`,
      },
    ];

    $("#stats").innerHTML = stats
      .map(
        (stat) => `
        <div class="stat">
          <p class="label">${esc(stat.label)} <span class="scope">/ ${esc(stat.scope)}</span></p>
          <p class="value">${esc(stat.value)}${stat.unit ? ` <small>${esc(stat.unit)}</small>` : ""}</p>
          <p class="note">${esc(stat.note)}</p>
        </div>`
      )
      .join("");
  }

  function renderLedger(cd) {
    const rows = cd.ledger || [];
    const max = Math.max(1, ...rows.map((row) => Number(row.reward) || 0));
    const unit = cd.token;

    $("#ledger-rows").innerHTML = rows
      .map((row) => {
        const segments = OUTCOMES.map((key) => {
          const value = Number(row.outcomes?.[key]) || 0;
          if (value <= 0) return "";
          return `<span class="seg ${key}" style="width:${((value / max) * 100).toFixed(3)}%"></span>`;
        }).join("");
        const aria = `${row.short}: ${fmtMoney(row.reward)} ${unit} total, ${OUTCOMES.map(
          (key) => `${fmtMoney(row.outcomes?.[key])} ${key}`
        ).join(", ")}`;
        return `
          <div class="ledger-row" role="listitem">
            <div class="who"><span class="addr">${esc(row.short)}</span><span class="tasks">${fmtInt(row.tasks)} tasks</span></div>
            <div class="bar" role="img" aria-label="${esc(aria)}">${segments}</div>
            <div class="total">${fmtMoney(row.reward)} <span>${esc(unit)}</span></div>
          </div>`;
      })
      .join("");

    const table = `
      <table>
        <thead><tr><th>Poster</th><th>Tasks</th><th>Settled</th><th>Waiting</th><th>Cancelled</th><th>Expired</th><th>Total (${esc(unit)})</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (row) => `<tr>
                <td>${esc(row.short)}</td>
                <td>${fmtInt(row.tasks)}</td>
                <td>${fmtMoney(row.outcomes?.settled)}</td>
                <td>${fmtMoney(row.outcomes?.waiting)}</td>
                <td>${fmtMoney(row.outcomes?.cancelled)}</td>
                <td>${fmtMoney(row.outcomes?.expired)}</td>
                <td>${fmtMoney(row.reward)}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>`;
    $("#ledger-table").innerHTML = table;

    const total = Number(cd.totalReward) || 0;
    const settled = total ? ((Number(cd.outcomes?.settled) || 0) / total) * 100 : 0;
    const waiting = total ? ((Number(cd.outcomes?.waiting) || 0) / total) * 100 : 0;
    const closed = total ? (((Number(cd.outcomes?.cancelled) || 0) + (Number(cd.outcomes?.expired) || 0)) / total) * 100 : 0;
    const topText = cd.posterCount > 10 ? "The top ten hold" : "The top posters hold";

    $("#ledger-takeaway").innerHTML =
      `<b>${fmtInt(cd.posterCount)} posters</b> put up <b>${fmtMoney(cd.totalReward)} ${esc(unit)}</b> across ${fmtInt(cd.taskCount)} public tasks on ${esc(cd.label)}. ` +
      `${topText} <b>${pct(cd.top10Share)}</b> of it. ${pct(settled)} has settled, ${pct(waiting)} is still waiting, and ${pct(closed)} was cancelled or expired.`;
  }

  function renderTimeline(cd) {
    const series = cd.series[state.range];
    const unit = unitFor("series");
    $("#flow-total").textContent = `${fmtMoney(series.totals.posted)} ${unit} posted, ${fmtMoney(series.totals.paid)} paid`;
    renderMoneyChart(series.buckets, unit);
    renderMinis(series.buckets);
  }

  function renderMoneyChart(buckets, unit) {
    const host = $("#money-chart");
    if (!host) return;
    const width = getWidth(host);
    const height = getHeight(host);
    const margin = { left: 56, right: 14, top: 16, bottom: 26 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    if (plotW < 60 || plotH < 40) return;

    const values = buckets.flatMap((bucket) => [Number(bucket.posted) || 0, Number(bucket.paid) || 0]);
    const maxValue = Math.max(1, ...values) * 1.08;
    const count = buckets.length;

    const x = (index) => margin.left + (count <= 1 ? plotW / 2 : (index / (count - 1)) * plotW);
    const y = (value) => margin.top + plotH - (value / maxValue) * plotH;

    const svg = svgRoot(
      host,
      width,
      height,
      `Rewards posted and paid, ${RANGE_LABELS[state.range]}. ${fmtMoney(
        buckets.reduce((sum, bucket) => sum + (Number(bucket.posted) || 0), 0)
      )} ${unit} posted.`
    );

    for (let line = 0; line <= 3; line++) {
      const value = maxValue * (1 - line / 3);
      const lineY = margin.top + (plotH / 3) * line;
      svg.appendChild(
        svgEl("line", {
          x1: margin.left,
          y1: lineY,
          x2: width - margin.right,
          y2: lineY,
          stroke: "rgba(69,62,55,0.72)",
          "stroke-width": 1,
        })
      );
      svg.appendChild(
        svgEl(
          "text",
          {
            x: margin.left - 8,
            y: lineY + 3,
            "text-anchor": "end",
            fill: "#b0a79d",
            "font-family": "Departure Mono, monospace",
            "font-size": 8.5,
          },
          axisNumber(value)
        )
      );
    }

    const indexSet = new Set([0, count - 1]);
    for (let mark = 1; mark <= 3; mark++) indexSet.add(Math.round((mark * (count - 1)) / 4));
    const xLabels = [...indexSet].sort((a, b) => a - b);
    for (const index of xLabels) {
      svg.appendChild(
        svgEl(
          "text",
          {
            x: x(index),
            y: height - 7,
            "text-anchor": index === 0 ? "start" : index === count - 1 ? "end" : "middle",
            fill: "#b0a79d",
            "font-family": "Departure Mono, monospace",
            "font-size": 8.5,
          },
          formatDateShort(buckets[index]?.date)
        )
      );
    }

    const postedPoints = buckets.map((bucket, index) => [x(index), y(Number(bucket.posted) || 0)]);
    const paidPoints = buckets.map((bucket, index) => [x(index), y(Number(bucket.paid) || 0)]);

    svg.appendChild(
      svgEl("path", {
        d: areaPath(postedPoints, margin.top + plotH),
        fill: "rgba(239,233,226,0.06)",
      })
    );
    svg.appendChild(
      svgEl("path", {
        d: linePath(postedPoints),
        fill: "none",
        stroke: "#efe9e2",
        "stroke-width": 1.5,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      })
    );
    svg.appendChild(
      svgEl("path", {
        d: linePath(paidPoints),
        fill: "none",
        stroke: "#d9a097",
        "stroke-width": 2,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      })
    );

    const lastIndex = count - 1;
    if (lastIndex >= 0) {
      svg.appendChild(svgEl("circle", { cx: postedPoints[lastIndex][0], cy: postedPoints[lastIndex][1], r: 2.8, fill: "#efe9e2" }));
      svg.appendChild(svgEl("circle", { cx: paidPoints[lastIndex][0], cy: paidPoints[lastIndex][1], r: 3.2, fill: "#d9a097" }));
    }

    const guide = svgEl("line", {
      x1: 0,
      y1: margin.top,
      x2: 0,
      y2: margin.top + plotH,
      stroke: "rgba(239,233,226,0.35)",
      "stroke-width": 1,
      "stroke-dasharray": "3 3",
      opacity: 0,
    });
    const postedDot = svgEl("circle", { r: 3.2, fill: "#efe9e2", opacity: 0 });
    const paidDot = svgEl("circle", { r: 3.6, fill: "#d9a097", opacity: 0 });
    svg.append(guide, postedDot, paidDot);

    const tip = document.createElement("div");
    tip.className = "chart-tip";
    host.appendChild(tip);

    const overlay = svgEl("rect", {
      x: margin.left,
      y: margin.top,
      width: plotW,
      height: plotH,
      fill: "transparent",
      "pointer-events": "all",
      cursor: "crosshair",
    });
    svg.appendChild(overlay);

    const hide = () => {
      guide.setAttribute("opacity", "0");
      postedDot.setAttribute("opacity", "0");
      paidDot.setAttribute("opacity", "0");
      tip.classList.remove("on");
    };

    overlay.addEventListener("pointermove", (event) => {
      const rect = host.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const index = clamp(Math.round(((localX - margin.left) / plotW) * (count - 1)), 0, count - 1);
      const bucket = buckets[index];
      if (!bucket) return;
      const pointX = x(index);

      guide.setAttribute("x1", pointX);
      guide.setAttribute("x2", pointX);
      guide.setAttribute("opacity", "1");
      postedDot.setAttribute("cx", pointX);
      postedDot.setAttribute("cy", y(Number(bucket.posted) || 0));
      postedDot.setAttribute("opacity", "1");
      paidDot.setAttribute("cx", pointX);
      paidDot.setAttribute("cy", y(Number(bucket.paid) || 0));
      paidDot.setAttribute("opacity", "1");

      tip.innerHTML = `<div class="tip-date">${esc(formatDateShort(bucket.date))}</div>
        <div class="tip-row"><span>Posted</span><b>${fmtMoney(bucket.posted)} ${esc(unit)}</b></div>
        <div class="tip-row"><span>Paid</span><b>${fmtMoney(bucket.paid)} ${esc(unit)}</b></div>
        <div class="tip-row"><span>Tasks</span><b>${fmtInt(bucket.tasks)}</b></div>
        <div class="tip-row"><span>Active agents</span><b>${fmtInt(bucket.activeAgents)}</b></div>`;
      const tipWidth = 170;
      tip.style.left = `${pointX + 12 + tipWidth > width ? pointX - tipWidth - 12 : pointX + 12}px`;
      tip.style.top = "8px";
      tip.classList.add("on");
    });

    overlay.addEventListener("pointerleave", hide);
    svg.addEventListener("pointerleave", hide);
  }

  function renderMinis(buckets) {
    const specs = [
      {
        key: "activeAgents",
        label: "Active agents / day",
        total: (rows) => fmtInt(rows.reduce((sum, row) => sum + (Number(row.activeAgents) || 0), 0)),
        note: (rows) => {
          const values = rows.map((row) => Number(row.activeAgents) || 0);
          return `peak ${fmtInt(Math.max(...values))}, latest ${fmtInt(values.at(-1) || 0)}`;
        },
      },
      {
        key: "tasks",
        label: "Tasks posted / day",
        total: (rows) => fmtInt(rows.reduce((sum, row) => sum + (Number(row.tasks) || 0), 0)),
        note: (rows) => `total ${fmtInt(rows.reduce((sum, row) => sum + (Number(row.tasks) || 0), 0))}`,
      },
      {
        key: "settlements",
        label: "Settlements / day",
        total: (rows) => fmtInt(rows.reduce((sum, row) => sum + (Number(row.settlements) || 0), 0)),
        note: (rows) => `total ${fmtInt(rows.reduce((sum, row) => sum + (Number(row.settlements) || 0), 0))}`,
      },
    ];

    $("#minis").innerHTML = specs
      .map(
        (spec) => `
        <div class="mini">
          <div class="mini-head"><span>${esc(spec.label)}</span><strong>${spec.total(buckets)}</strong></div>
          <div class="mini-chart" data-mini="${spec.key}" role="img" aria-label="${esc(spec.label)}"></div>
          <p class="mini-note">${esc(spec.note(buckets))}</p>
        </div>`
      )
      .join("");

    for (const spec of specs) {
      const host = $(`[data-mini="${spec.key}"]`);
      if (host) sparkline(host, buckets.map((row) => Number(row[spec.key]) || 0), spec.label);
    }
  }

  function sparkline(host, values, label) {
    const width = getWidth(host, 300);
    const height = getHeight(host, 64);
    const svg = svgRoot(host, width, height, label);
    if (!values.length) return;
    const pad = 4;
    const max = Math.max(1, ...values);
    const count = values.length;
    const x = (index) => pad + (count <= 1 ? 0 : (index / (count - 1)) * (width - pad * 2));
    const y = (value) => height - pad - (value / max) * (height - pad * 2);
    const points = values.map((value, index) => [x(index), y(value)]);
    svg.appendChild(
      svgEl("path", {
        d: areaPath(points, height - pad),
        fill: "rgba(239,233,226,0.05)",
      })
    );
    svg.appendChild(
      svgEl("path", {
        d: linePath(points),
        fill: "none",
        stroke: "#d9a097",
        "stroke-width": 1.4,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      })
    );
    const last = points[points.length - 1];
    svg.appendChild(svgEl("circle", { cx: last[0], cy: last[1], r: 2.4, fill: "#fff6e8" }));
  }

  function linePath(points) {
    if (!points.length) return "";
    return points.map((point, index) => `${index === 0 ? "M" : "L"}${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(" ");
  }

  function areaPath(points, baseY) {
    if (!points.length) return "";
    const first = points[0];
    const last = points[points.length - 1];
    return `${linePath(points)} L${last[0].toFixed(2)},${baseY.toFixed(2)} L${first[0].toFixed(2)},${baseY.toFixed(2)} Z`;
  }

  function axisNumber(value) {
    if (value >= 1000) return `${fmtOne(value / 1000)}k`;
    if (value >= 100) return fmtInt(value);
    if (value >= 10) return fmtOne(value);
    return fmtOne(value);
  }

  function renderEscrow(cd) {
    const escrow = cd.escrow;
    const max = Math.max(1, ...escrow.buckets.map((bucket) => Number(bucket.reward) || 0));
    const head = `<div class="escrow-row escrow-head"><span class="escrow-label">Age</span><span class="escrow-count">Tasks</span><span></span><span class="escrow-amount">Reward</span></div>`;
    const rows = escrow.buckets
      .map((bucket) => {
        const value = Number(bucket.reward) || 0;
        const hot = bucket.label === ">7d" && value > 0;
        return `<div class="escrow-row${hot ? " hot" : ""}">
          <span class="escrow-label">${esc(bucket.label)}</span>
          <span class="escrow-count">${fmtInt(bucket.count)}</span>
          <span class="escrow-track"><span class="escrow-fill" style="width:${((value / max) * 100).toFixed(2)}%"></span></span>
          <span class="escrow-amount">${fmtMoney(value)}</span>
        </div>`;
      })
      .join("");
    const oldest = (escrow.oldest || [])
      .map((task) => {
        const age = Number(task.ageHours) || 0;
        const ageLabel = age >= 48 ? `${Math.round(age / 24)}d` : `${Math.round(age)}h`;
        return `<li>
          <span class="oldest-age">${ageLabel}</span>
          <span class="oldest-title" title="${esc(task.title)}">${esc(task.title)}</span>
          <span class="oldest-reward">${fmtMoney(task.reward)} ${esc(cd.token)}</span>
        </li>`;
      })
      .join("");
    const oldestBlock = oldest
      ? `<div class="oldest">
          <p class="oldest-head">Oldest waiting, public task list</p>
          <ol>${oldest}</ol>
        </div>`
      : "";
    $("#escrow").innerHTML = head + rows + oldestBlock;

    if (!escrow.count) {
      $("#escrow-takeaway").textContent = `Nothing is waiting on ${cd.label} in this snapshot.`;
      return;
    }
    const overWeekShare = escrow.total ? (escrow.overWeek.reward / escrow.total) * 100 : 0;
    $("#escrow-takeaway").innerHTML =
      `<b>${fmtInt(escrow.count)} public tasks</b> are waiting with <b>${fmtMoney(escrow.total)} ${esc(cd.token)}</b> in escrow, ` +
      `${pct(escrow.shareOfPosted)} of everything posted on ${esc(cd.label)}. ${fmtInt(escrow.overWeek.count)} have waited more than a week, holding ${fmtMoney(escrow.overWeek.reward)} (${pct(overWeekShare)} of the waiting total).`;
  }

  function renderPosters(cd) {
    const weeks = cd.weeklyPosters || [];
    $("#posters-total").textContent = `${fmtInt(cd.posterCount)} distinct posters all time`;
    const host = $("#posters-chart");
    if (!host) return;
    const width = getWidth(host, 520);
    const height = getHeight(host, 228);
    const margin = { left: 22, right: 8, top: 18, bottom: 26 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    if (plotW < 60 || plotH < 40) return;

    const max = Math.max(1, ...weeks.map((week) => Number(week.posters) || 0));
    const slot = plotW / Math.max(1, weeks.length);
    const barW = Math.min(34, slot * 0.58);
    const svg = svgRoot(host, width, height, `Distinct posters per week on ${cd.label}`);
    const peak = weeks
      .filter((week) => !week.partial)
      .reduce((best, week) => (Number(week.posters) > Number(best?.posters || -1) ? week : best), null);

    const defs = svgEl("defs");
    const pattern = svgEl("pattern", {
      id: "partial-hatch",
      width: 5,
      height: 5,
      patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)",
    });
    pattern.appendChild(svgEl("rect", { width: 5, height: 5, fill: "#2a2520" }));
    pattern.appendChild(svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 5, stroke: "#7d6e62", "stroke-width": 1 }));
    defs.appendChild(pattern);
    svg.appendChild(defs);

    weeks.forEach((week, index) => {
      const value = Number(week.posters) || 0;
      const barH = (value / max) * plotH;
      const x = margin.left + index * slot + (slot - barW) / 2;
      const y = margin.top + plotH - barH;
      const isPeak = peak && week.week === peak.week;
      const fill = week.partial ? "url(#partial-hatch)" : isPeak ? "#d9a097" : "#6e6157";
      const rect = svgEl("rect", {
        x,
        y,
        width: barW,
        height: Math.max(barH, value ? 2 : 0),
        rx: 2,
        fill,
        stroke: week.partial ? "#d9a097" : "none",
        "stroke-width": week.partial ? 1 : 0,
        "stroke-dasharray": week.partial ? "3 2" : "none",
      });
      rect.appendChild(
        svgEl(
          "title",
          {},
          `${week.week}${week.partial ? " (partial)" : ""}: ${value} posters, ${fmtInt(week.tasks)} tasks, ${fmtMoney(week.reward)} ${cd.token}`
        )
      );
      svg.appendChild(rect);

      if (value > 0) {
        svg.appendChild(
          svgEl(
            "text",
            {
              x: x + barW / 2,
              y: y - 5,
              "text-anchor": "middle",
              fill: isPeak || week.partial ? "#d9a097" : "#b0a79d",
              "font-family": "Departure Mono, monospace",
              "font-size": 8,
            },
            String(value)
          )
        );
      }

      svg.appendChild(
        svgEl(
          "text",
          {
            x: x + barW / 2,
            y: height - 8,
            "text-anchor": "middle",
            fill: "#b0a79d",
            "font-family": "Departure Mono, monospace",
            "font-size": 8,
          },
          `${formatWeekShort(week.week)}${week.partial ? "*" : ""}`
        )
      );
    });

    svg.appendChild(
      svgEl("line", {
        x1: margin.left,
        y1: margin.top + plotH,
        x2: width - margin.right,
        y2: margin.top + plotH,
        stroke: "rgba(69,62,55,0.9)",
        "stroke-width": 1,
      })
    );

    const complete = weeks.filter((week) => !week.partial);
    const last = complete[complete.length - 1];
    if (!last) {
      $("#posters-takeaway").textContent = "No complete week in this snapshot yet.";
      return;
    }
    if (peak && peak.week === last.week) {
      $("#posters-takeaway").innerHTML = `<b>${fmtInt(peak.posters)} distinct posters</b> in ${esc(peak.week)}, the highest complete week in the window.`;
    } else {
      $("#posters-takeaway").innerHTML = `<b>${fmtInt(peak?.posters)} distinct posters</b> in ${esc(peak?.week)}. The last complete week, ${esc(last.week)}, added <b>${fmtInt(last.posters)}</b>.`;
    }
  }

  function renderMix(cd) {
    const breakdowns = cd.breakdowns || { mode: [], status: [] };
    const modeTotal = breakdowns.mode.reduce((sum, row) => sum + row.count, 0);
    const statusTotal = breakdowns.status.reduce((sum, row) => sum + row.count, 0);
    const scope = isPlatform("breakdowns") ? "all chains" : cd.label;
    $("#mode-total").textContent = `${fmtInt(modeTotal)} tasks, ${scope}`;
    $("#status-total").textContent = `${fmtInt(statusTotal)} tasks, ${scope}`;
    renderBarList($("#mode-bars"), breakdowns.mode, modeTotal);
    renderBarList($("#status-bars"), breakdowns.status, statusTotal);
  }

  function renderBarList(host, rows, total) {
    if (!host) return;
    const sorted = [...rows].sort((a, b) => Number(b.count) - Number(a.count));
    const max = Math.max(1, ...sorted.map((row) => Number(row.count) || 0));
    host.innerHTML = sorted
      .map(
        (row) => `<div class="mix-row">
          <span class="mix-label" title="${esc(humanize(row.key))}">${esc(humanize(row.key))}</span>
          <span class="mix-count">${fmtInt(row.count)}</span>
          <span class="mix-track"><span class="mix-fill" style="width:${(((Number(row.count) || 0) / max) * 100).toFixed(2)}%"></span></span>
          <span class="mix-pct">${pct(total ? ((Number(row.count) || 0) / total) * 100 : 0)}</span>
        </div>`
      )
      .join("");
  }

  function renderHeatmap(cd) {
    const heat = cd.heatmaps[state.range];
    const host = $("#heatmap");
    if (!host || !heat) return;
    const cellMap = new Map(heat.cells.map((cell) => [`${cell.row}:${cell.col}`, cell]));
    const width = 780;
    const height = 236;
    const margin = { left: 38, right: 8, top: 24, bottom: 20 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const colW = plotW / heat.colKeys.length;
    const rowH = plotH / heat.rowKeys.length;
    const max = Math.max(1, heat.max);
    const svg = svgRoot(host, width, height, `Activity heatmap, ${RANGE_LABELS[state.range]}`);

    svg.appendChild(
      svgEl(
        "text",
        {
          x: margin.left - 8,
          y: 10,
          "text-anchor": "end",
          fill: "#b0a79d",
          "font-family": "Departure Mono, monospace",
          "font-size": 8,
        },
        "UTC"
      )
    );

    heat.rowKeys.forEach((row, rowIndex) => {
      const y = margin.top + rowIndex * rowH;
      svg.appendChild(
        svgEl(
          "text",
          {
            x: margin.left - 8,
            y: y + rowH / 2 + 3,
            "text-anchor": "end",
            fill: "#b0a79d",
            "font-family": "Departure Mono, monospace",
            "font-size": 8.5,
          },
          DAYS[Number(row)] || `D${row}`
        )
      );
      heat.colKeys.forEach((col, colIndex) => {
        const cell = cellMap.get(`${row}:${col}`);
        const count = Number(cell?.count) || 0;
        const x = margin.left + colIndex * colW;
        const isPeak = cell && heat.peak && String(cell.row) === String(heat.peak.row) && String(cell.col) === String(heat.peak.col) && count > 0;
        const rect = svgEl("rect", {
          x: x + 1,
          y: y + 1,
          width: Math.max(1, colW - 2),
          height: Math.max(1, rowH - 2),
          rx: 2,
          fill: isPeak ? "#fff6e8" : heatColor(count / max),
          stroke: isPeak ? "#d9a097" : "none",
          "stroke-width": isPeak ? 1 : 0,
        });
        rect.appendChild(
          svgEl("title", {}, `${DAYS[Number(row)] || row} ${String(col).padStart(2, "0")}:00, ${fmtInt(count)} events`)
        );
        svg.appendChild(rect);
      });
    });

    heat.colKeys.forEach((col, index) => {
      const hour = Number(col);
      if (hour % 3 !== 0) return;
      svg.appendChild(
        svgEl(
          "text",
          {
            x: margin.left + index * colW + colW / 2,
            y: height - 6,
            "text-anchor": "middle",
            fill: "#b0a79d",
            "font-family": "Departure Mono, monospace",
            "font-size": 8,
          },
          `${String(hour).padStart(2, "0")}:00`
        )
      );
    });

    if (heat.max > 0) {
      const day = DAYS[Number(heat.peak.row)] || `day ${heat.peak.row}`;
      $("#peak").innerHTML = `Busiest cell: <b>${esc(day)}, ${String(heat.peak.col).padStart(2, "0")}:00</b> with <b>${fmtInt(heat.peak.count)} events</b>.`;
    } else {
      $("#peak").textContent = "No public activity in this range.";
    }
  }

  function heatColor(ratio) {
    if (!ratio) return "#221e1a";
    if (ratio < 0.08) return "#3a2a26";
    if (ratio < 0.2) return "#5a3a34";
    if (ratio < 0.38) return "#7d4a40";
    if (ratio < 0.62) return "#a65a4f";
    return "#d9a097";
  }

  function renderFeed(cd) {
    const feed = cd.feed || [];
    const host = $("#feed");
    if (!host) return;
    if (!feed.length) {
      host.innerHTML = `<li class="empty">No public events in this snapshot for ${esc(cd.label)}.</li>`;
      return;
    }
    host.innerHTML = feed
      .map((item) => {
        const type = String(item.type || "event").replace(/^task_/, "").replace(/_/g, " ");
        const typeClass = /submit/.test(type) ? "submitted" : /complet|paid/.test(type) ? "completed" : "";
        const actor = item.actor ? shortAddress(item.actor) : item.agentId ? `agent ${item.agentId}` : "unknown actor";
        const actorKind = item.actorType || "actor";
        const chainTag = item.chainId === 4217 ? "tempo" : item.chainId === 8453 ? "base" : "";
        const title = item.taskTitle || "Untitled task";
        const time = formatTime(item.timestamp);
        return `<li>
          <time datetime="${esc(item.timestamp || "")}" title="${esc(item.timestamp || "")}">${esc(time)}</time>
          <span class="chip ${typeClass}">${esc(type)}</span>
          <span class="title" title="${esc(title)}">${esc(title)}</span>
          <span class="actor">${chainTag ? `${esc(chainTag)} &middot; ` : ""}${esc(actorKind)} &middot; ${esc(actor)}</span>
        </li>`;
      })
      .join("");
  }

  function debounce(callback, wait) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => callback(...args), wait);
    };
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
      } catch (error) {
        reject(error);
      } finally {
        area.remove();
      }
    });
  }

  function bind() {
    $$("[data-chain]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!CHAINS.includes(button.dataset.chain)) return;
        state.chain = button.dataset.chain;
        writeHash();
        renderAll();
      });
    });

    $$("[data-range]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!RANGES.includes(button.dataset.range)) return;
        state.range = button.dataset.range;
        writeHash();
        renderAll();
      });
    });

    $("#share")?.addEventListener("click", async () => {
      const button = $("#share");
      const base = location.origin + location.pathname.replace(/index\.html$/, "").replace(/\/$/, "");
      const url = `${base}/s/${state.chain}-${state.range}.html`;
      try {
        await copyText(url);
        button.textContent = "Link copied";
        button.classList.add("copied");
        setTimeout(() => {
          button.textContent = "Copy share link";
          button.classList.remove("copied");
        }, 1600);
      } catch {
        button.textContent = "Copy failed";
        setTimeout(() => {
          button.textContent = "Copy share link";
        }, 1600);
      }
    });

    $("#ledger-toggle")?.addEventListener("click", () => {
      const table = $("#ledger-table");
      const button = $("#ledger-toggle");
      const open = table.hasAttribute("hidden");
      if (open) {
        table.removeAttribute("hidden");
      } else {
        table.setAttribute("hidden", "");
      }
      button.setAttribute("aria-expanded", String(open));
      button.textContent = open ? "Hide the numbers" : "Show the numbers";
    });

    window.addEventListener(
      "resize",
      debounce(() => {
        if (!state.data) return;
        renderTimeline(chainData());
        renderPosters(chainData());
      }, 160)
    );

    window.addEventListener("hashchange", () => {
      readHash();
      if (state.data) renderAll();
    });
  }

  readHash();
  bind();
  load();
  setInterval(() => {
    if (document.visibilityState === "visible") load();
  }, 15 * 60 * 1000);
})();
