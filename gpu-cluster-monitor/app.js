const GPU_TYPES = ["H100", "A100", "A100_40GB"];
const GPU_META = {
  H100: { label: "H100", color: "#0f9b8e", cssClass: "value-h100" },
  A100: { label: "A100", color: "#1c63d5", cssClass: "value-a100" },
  A100_40GB: { label: "A100-40GB", color: "#e58a00", cssClass: "value-a100-40" }
};

const PERIOD_LIMIT = {
  daily: 60,
  weekly: 52,
  monthly: 36
};

const state = {
  rangeHours: 24,
  period: "daily",
  periodMetric: "cost",
  cumulativeRange: "window",
  tableRows: 24,
  snapshots: [],
  aggregates: null,
  health: null,
  charts: {}
};

const fmtHour = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function toDate(value) {
  return new Date(value);
}

function sumValues(record) {
  return Object.values(record || {}).reduce((acc, value) => acc + Number(value || 0), 0);
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatDecimal(value, decimals = 2) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(Number(value || 0));
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function formatCurrencyCompact(value) {
  const num = Number(value || 0);
  if (num >= 1000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(num);
  }
  return formatCurrency(num);
}

function formatHour(value) {
  return `${fmtHour.format(toDate(value))} UTC`;
}

function parseSnapshots(doc) {
  if (!doc || !Array.isArray(doc.snapshots)) {
    return [];
  }
  return [...doc.snapshots].sort((a, b) => new Date(a.hour) - new Date(b.hour));
}

async function fetchJson(path) {
  const response = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status}`);
  }
  return response.json();
}

async function loadData() {
  const [snapshotsDoc, aggregates, health] = await Promise.all([
    fetchJson("./data/snapshots.json"),
    fetchJson("./data/aggregates.json"),
    fetchJson("./data/health.json")
  ]);

  state.snapshots = parseSnapshots(snapshotsDoc);
  state.aggregates = aggregates;
  state.health = health;
}

function getRangeSnapshots() {
  if (!state.snapshots.length) {
    return [];
  }
  const latestHour = toDate(state.snapshots[state.snapshots.length - 1].hour);
  const cutoff = new Date(latestHour.getTime() - (state.rangeHours - 1) * 3600 * 1000);
  return state.snapshots.filter((snapshot) => toDate(snapshot.hour) >= cutoff);
}

function renderMeta() {
  const latest = state.aggregates?.latest || null;
  const lastHourEl = document.getElementById("meta-last-hour");
  const updatedEl = document.getElementById("meta-updated-at");
  const qualityEl = document.getElementById("meta-quality");

  if (!latest) {
    lastHourEl.textContent = "-";
    updatedEl.textContent = "-";
    qualityEl.textContent = "-";
    return;
  }

  lastHourEl.textContent = formatHour(latest.hour);
  updatedEl.textContent = formatHour(state.aggregates.generated_at);

  const coverage = state.aggregates.quality?.coverage_pct ?? 0;
  const observed = state.aggregates.quality?.observed_hours ?? 0;
  const total = observed + (state.aggregates.quality?.estimated_hours ?? 0);
  qualityEl.textContent = `${formatDecimal(coverage, 1)}% observed (${observed}/${total})`;
}

function renderHealth() {
  const pill = document.getElementById("health-pill");
  const messageEl = document.getElementById("health-message");
  const health = state.health || {};
  const aggregates = state.aggregates || {};

  pill.classList.remove("health-ok", "health-degraded", "health-error", "health-neutral");
  const status = health.status || "neutral";

  if (status === "ok") {
    pill.classList.add("health-ok");
    pill.textContent = "Healthy";
  } else if (status === "degraded") {
    pill.classList.add("health-degraded");
    pill.textContent = "Degraded";
  } else if (status === "error") {
    pill.classList.add("health-error");
    pill.textContent = "Error";
  } else {
    pill.classList.add("health-neutral");
    pill.textContent = "Unknown";
  }

  const staleSuffix = aggregates.is_stale ? " Data is stale." : "";
  messageEl.textContent = health.message
    ? `${health.message}${staleSuffix}`
    : `Latest hour: ${health.latest_hour ? formatHour(health.latest_hour) : "n/a"}.${staleSuffix}`;
}

function renderPricing() {
  const pricing = state.aggregates?.pricing || null;
  const defEl = document.getElementById("pricing-definition");
  const body = document.getElementById("pricing-table-body");
  const links = document.getElementById("pricing-source-links");

  if (!pricing || !pricing.instances) {
    defEl.textContent = "Pricing data unavailable.";
    body.innerHTML = '<tr><td colspan="5" class="muted-cell">No pricing model provided.</td></tr>';
    links.innerHTML = "";
    return;
  }

  const refStamp = pricing.reference_publication_utc ? `Reference publication: ${pricing.reference_publication_utc}.` : "";
  defEl.textContent = `${pricing.market_price_definition} ${refStamp}`;

  body.innerHTML = GPU_TYPES.map((gpuType) => {
    const row = pricing.instances[gpuType] || {};
    return `
      <tr>
        <td><span class="gpu-dot" style="background:${GPU_META[gpuType].color}"></span> <span class="${GPU_META[gpuType].cssClass}">${GPU_META[gpuType].label}</span></td>
        <td class="mono">${row.instance_type || "-"}</td>
        <td class="mono">${formatCurrency(row.node_hourly_usd || 0)}</td>
        <td class="mono">${formatCurrency(row.gpu_hourly_usd || 0)}</td>
        <td>${pricing.name || "-"}</td>
      </tr>
    `;
  }).join("");

  const src = Array.isArray(pricing.source_links) ? pricing.source_links : [];
  const linkHtml = src.map((item) => (
    `<a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.label}</a>`
  )).join(' <span class="source-sep">\u00b7</span> ');
  links.innerHTML = src.length ? `<span class="source-label">Authentic Sources:</span> ${linkHtml}` : "";
}

function computePeriodDelta(periodArray) {
  if (!periodArray || periodArray.length < 2) return null;
  const cur = periodArray[periodArray.length - 1];
  const prev = periodArray[periodArray.length - 2];
  const curHours = cur?.hours || 0;
  const prevHours = prev?.hours || 0;
  if (curHours < 6 || prevHours < 6) return null;
  const curRate = (cur?.total_cost || 0) / curHours;
  const prevRate = (prev?.total_cost || 0) / prevHours;
  if (!prevRate) return null;
  return ((curRate - prevRate) / prevRate) * 100;
}

function formatDeltaHtml(pct) {
  if (pct === null || pct === undefined) return "";
  const cls = pct > 0 ? "delta-up" : pct < 0 ? "delta-down" : "delta-flat";
  const arrow = pct > 0 ? "\u2191" : pct < 0 ? "\u2193" : "";
  const sign = pct >= 0 ? "+" : "";
  let label;
  if (Math.abs(pct) > 999) {
    label = `${sign}999%+`;
  } else if (Math.abs(pct) >= 100) {
    label = `${sign}${Math.round(pct)}%`;
  } else {
    label = `${sign}${pct.toFixed(1)}%`;
  }
  return `<span class="kpi-delta ${cls}">${arrow}${label}</span>`;
}

function gpuBreakdownHtml() {
  const latest = state.aggregates?.latest || {};
  const gpus = latest.gpus || {};
  return GPU_TYPES.filter((t) => gpus[t]).map((t) =>
    `<span class="kpi-chip" style="color:${GPU_META[t].color}">${GPU_META[t].label}: ${formatInteger(gpus[t])}</span>`
  ).join(" ");
}

function costBreakdownHtml() {
  const latest = state.aggregates?.latest || {};
  const cost = latest.hourly_cost || {};
  return GPU_TYPES.filter((t) => cost[t]).map((t) =>
    `<span class="kpi-chip" style="color:${GPU_META[t].color}">${GPU_META[t].label}: ${formatCurrency(cost[t])}</span>`
  ).join(" ");
}

function buildKpiCards() {
  const kpis = state.aggregates?.kpis || {};
  const rolling24 = state.aggregates?.rolling?.["24h"] || {};
  const rolling7d = state.aggregates?.rolling?.["7d"] || {};
  const rolling30d = state.aggregates?.rolling?.["30d"] || {};
  const daily = state.aggregates?.daily || [];
  const weekly = state.aggregates?.weekly || [];
  const monthly = state.aggregates?.monthly || [];

  return [
    {
      title: "Current GPUs",
      value: formatInteger(kpis.current_gpus_total || 0),
      sub: `${formatInteger(kpis.current_nodes_total || 0)} nodes`,
      extra: gpuBreakdownHtml(),
      wide: true
    },
    {
      title: "Current Hourly Cost",
      value: formatCurrencyCompact(kpis.current_hourly_cost || 0),
      sub: "Based on active nodes now",
      extra: costBreakdownHtml(),
      wide: true
    },
    {
      title: "24h Total Cost",
      value: formatCurrencyCompact(rolling24.total_cost || 0),
      delta: computePeriodDelta(daily),
      sub: `${formatInteger(rolling24.hours || 0)} hourly snapshots`
    },
    {
      title: "Weekly Total Cost",
      value: formatCurrencyCompact(rolling7d.total_cost || 0),
      delta: computePeriodDelta(weekly),
      sub: `${formatInteger(rolling7d.hours || 0)} hourly snapshots`
    },
    {
      title: "Monthly Total Cost",
      value: formatCurrencyCompact(rolling30d.total_cost || 0),
      delta: computePeriodDelta(monthly),
      sub: `${formatInteger(rolling30d.hours || 0)} hourly snapshots`
    },
    {
      title: "All-Time Cost",
      value: formatCurrencyCompact(kpis.all_time_total_cost || 0),
      sub: "Accumulated from all hourly snapshots"
    }
  ];
}

function renderKpis() {
  const container = document.getElementById("kpi-grid");
  const cards = buildKpiCards();
  container.innerHTML = cards.map((card) => `
    <article class="kpi-card${card.wide ? " kpi-wide" : ""}">
      <div class="kpi-title">${card.title}${card.delta != null ? formatDeltaHtml(card.delta) : ""}</div>
      <div class="kpi-value">${card.value}</div>
      <div class="kpi-sub">${card.sub}</div>
      ${card.extra ? `<div class="kpi-extra">${card.extra}</div>` : ""}
    </article>
  `).join("");
}

function renderRollingCards() {
  const rolling = state.aggregates?.rolling || {};
  const items = [
    { key: "24h", label: "Last 24 Hours" },
    { key: "7d", label: "Last 7 Days" },
    { key: "30d", label: "Last 30 Days" }
  ];
  const container = document.getElementById("rolling-cards");
  container.innerHTML = items.map((item) => {
    const value = rolling[item.key] || {};
    return `
      <article class="rolling-card">
        <span>${item.label}</span>
        <strong>${formatCurrency(value.total_cost || 0)}</strong>
        <small>${formatInteger(value.total_gpu_hours || 0)} GPU-hours | ${formatInteger(value.total_node_hours || 0)} node-hours</small>
      </article>
    `;
  }).join("");
}

function upsertChart(chartKey, canvasId, config) {
  if (state.charts[chartKey]) {
    state.charts[chartKey].destroy();
  }
  const ctx = document.getElementById(canvasId).getContext("2d");
  state.charts[chartKey] = new Chart(ctx, config);
}

function baseChartOptions({ stacked = false, yLabel = "" } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 350, easing: "easeOutQuart" },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        labels: {
          boxWidth: 10,
          usePointStyle: true,
          padding: 16,
          font: { family: "'Space Grotesk', sans-serif", size: 12 }
        }
      },
      tooltip: {
        backgroundColor: "rgba(15, 23, 42, 0.9)",
        titleFont: { family: "'Space Grotesk', sans-serif", size: 12, weight: "600" },
        bodyFont: { family: "'IBM Plex Mono', monospace", size: 12 },
        padding: { top: 8, bottom: 8, left: 12, right: 12 },
        cornerRadius: 8,
        callbacks: {
          label(context) {
            const raw = Number(context.raw || 0);
            if (yLabel === "USD") {
              return ` ${context.dataset.label}: ${formatCurrency(raw)}`;
            }
            return ` ${context.dataset.label}: ${formatDecimal(raw, 2)}`;
          }
        }
      }
    },
    scales: {
      x: {
        stacked,
        ticks: {
          maxTicksLimit: 12,
          font: { family: "'Space Grotesk', sans-serif", size: 11 },
          color: "#94a3b8"
        },
        grid: { color: "rgba(226, 232, 240, 0.6)", drawBorder: false }
      },
      y: {
        stacked,
        title: {
          display: Boolean(yLabel),
          text: yLabel,
          font: { family: "'Space Grotesk', sans-serif", size: 12, weight: "500" },
          color: "#94a3b8"
        },
        ticks: {
          font: { family: "'IBM Plex Mono', monospace", size: 11 },
          color: "#94a3b8"
        },
        grid: { color: "rgba(226, 232, 240, 0.6)", drawBorder: false }
      }
    }
  };
}

function renderGpuUsageChart() {
  const snapshots = getRangeSnapshots();
  const labels = snapshots.map((s) => fmtHour.format(toDate(s.hour)));
  const datasets = GPU_TYPES.map((gpuType) => ({
    label: GPU_META[gpuType].label,
    data: snapshots.map((s) => Number(s.gpus?.[gpuType] || 0)),
    borderColor: GPU_META[gpuType].color,
    backgroundColor: `${GPU_META[gpuType].color}33`,
    fill: true,
    tension: 0.2,
    stack: "gpu",
    pointRadius: 0
  }));

  const quality = state.aggregates?.quality || {};
  const coverage = quality.coverage_pct ?? 0;
  const observed = quality.observed_hours ?? 0;
  const estimated = quality.estimated_hours ?? 0;
  document.getElementById("gpu-usage-subtitle").textContent =
    `Stacked by GPU type \u00b7 ${formatDecimal(coverage, 1)}% observed (${observed} obs / ${estimated} est)`;

  upsertChart("gpuUsage", "gpu-usage-chart", {
    type: "line",
    data: { labels, datasets },
    options: baseChartOptions({ stacked: true, yLabel: "GPUs" })
  });
}

function renderHourlyCostChart() {
  const snapshots = getRangeSnapshots();
  const labels = snapshots.map((s) => fmtHour.format(toDate(s.hour)));
  const estimated = snapshots.map((s) => (s.estimated ? Number(s.total_hourly_cost || 0) : null));

  upsertChart("hourlyCost", "hourly-cost-chart", {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Hourly Cost",
          data: snapshots.map((s) => Number(s.total_hourly_cost || 0)),
          borderColor: "#1c63d5",
          backgroundColor: "rgba(28, 99, 213, 0.15)",
          tension: 0.2,
          fill: true,
          pointRadius: 0
        },
        {
          label: "Estimated Snapshot",
          data: estimated,
          borderColor: "#e58a00",
          backgroundColor: "#e58a00",
          showLine: false,
          pointRadius: 3
        }
      ]
    },
    options: baseChartOptions({ yLabel: "USD" })
  });
}

const fmtDay = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "2-digit"
});

function renderCumulativeCostChart() {
  const useAll = state.cumulativeRange === "all";
  const snapshots = useAll ? state.snapshots : getRangeSnapshots();

  let running = 0;
  const raw = snapshots.map((s) => {
    running += Number(s.total_hourly_cost || 0);
    return { hour: s.hour, cost: Number(running.toFixed(2)) };
  });

  let labels, values;
  if (useAll || snapshots.length > 168) {
    const byDay = new Map();
    for (const entry of raw) {
      const dayKey = fmtDay.format(toDate(entry.hour));
      byDay.set(dayKey, entry.cost);
    }
    labels = [...byDay.keys()];
    values = [...byDay.values()];
  } else {
    labels = raw.map((e) => fmtHour.format(toDate(e.hour)));
    values = raw.map((e) => e.cost);
  }

  upsertChart("cumulativeCost", "cumulative-cost-chart", {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Cumulative Cost",
          data: values,
          borderColor: "#0f9b8e",
          backgroundColor: "rgba(15, 155, 142, 0.1)",
          tension: 0.18,
          fill: true,
          pointRadius: 0
        }
      ]
    },
    options: baseChartOptions({ yLabel: "USD" })
  });
}

function getPeriodRows() {
  const list = state.aggregates?.[state.period] || [];
  const limit = PERIOD_LIMIT[state.period] || list.length;
  return list.slice(-limit);
}

function extractPeriodValue(row, gpuType) {
  if (state.periodMetric === "cost") {
    return Number(row.cost_by_type?.[gpuType] || 0);
  }
  if (state.periodMetric === "gpu_hours") {
    return Number(row.gpu_hours?.[gpuType] || 0);
  }
  return Number(row.node_hours?.[gpuType] || 0);
}

function formatPeriodLabel(periodKey) {
  if (state.period === "daily") {
    return periodKey.slice(5);
  }
  return periodKey;
}

function renderPeriodChart() {
  const rows = getPeriodRows();
  const labels = rows.map((row) => formatPeriodLabel(row.period));
  const unitLabel = state.periodMetric === "cost" ? "USD" : state.periodMetric === "gpu_hours" ? "GPU-hours" : "Node-hours";

  const datasets = GPU_TYPES.map((gpuType) => ({
    label: GPU_META[gpuType].label,
    data: rows.map((row) => extractPeriodValue(row, gpuType)),
    backgroundColor: `${GPU_META[gpuType].color}cc`,
    borderColor: GPU_META[gpuType].color,
    borderWidth: 1,
    stack: "total",
    type: "bar"
  }));

  const totalData = rows.map((row) => {
    if (state.periodMetric === "cost") {
      return Number(row.total_cost || 0);
    }
    if (state.periodMetric === "gpu_hours") {
      return Number(row.total_gpu_hours || 0);
    }
    return Number(row.total_node_hours || 0);
  });

  datasets.push({
    label: "Total",
    data: totalData,
    borderColor: "#15243b",
    backgroundColor: "#15243b",
    pointRadius: 2,
    fill: false,
    tension: 0.2,
    type: "line",
    yAxisID: "y"
  });

  const prettyPeriod = state.period[0].toUpperCase() + state.period.slice(1);
  const prettyMetric = state.periodMetric === "cost" ? "Total Cost (USD)" : state.periodMetric === "gpu_hours" ? "GPU-Hours" : "Node-Hours";
  document.getElementById("period-chart-subtitle").textContent = `${prettyPeriod} totals by GPU type \u00b7 ${prettyMetric}`;

  upsertChart("period", "period-chart", {
    type: "bar",
    data: { labels, datasets },
    options: baseChartOptions({ stacked: true, yLabel: unitLabel })
  });
}

function renderCostShareChart() {
  const costByType = state.aggregates?.all_time?.cost_by_type || {};
  const data = GPU_TYPES.map((gpuType) => Number(costByType[gpuType] || 0));
  const total = data.reduce((a, b) => a + b, 0);
  upsertChart("costShare", "cost-share-chart", {
    type: "doughnut",
    data: {
      labels: GPU_TYPES.map((gpuType) => GPU_META[gpuType].label),
      datasets: [
        {
          data,
          backgroundColor: GPU_TYPES.map((gpuType) => `${GPU_META[gpuType].color}dd`),
          hoverBackgroundColor: GPU_TYPES.map((gpuType) => GPU_META[gpuType].color),
          borderWidth: 2,
          borderColor: "#ffffff"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            padding: 16,
            usePointStyle: true,
            pointStyle: "circle",
            font: { family: "'Space Grotesk', sans-serif", size: 12 }
          }
        },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.9)",
          cornerRadius: 8,
          bodyFont: { family: "'IBM Plex Mono', monospace", size: 12 },
          callbacks: {
            label(context) {
              const pct = total > 0 ? ((context.raw / total) * 100).toFixed(1) : 0;
              return ` ${context.label}: ${formatCurrency(context.raw)} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

function statusTag(snapshot) {
  if (snapshot.fetch_ok) {
    return '<span class="tag tag-observed">Observed</span>';
  }
  if (snapshot.estimated) {
    return '<span class="tag tag-estimated">Estimated</span>';
  }
  return '<span class="tag tag-error">Error</span>';
}

function renderRecentTable() {
  const tbody = document.getElementById("recent-hours-body");
  const subtitle = document.getElementById("recent-table-subtitle");
  const rows = [...state.snapshots].slice(-state.tableRows).reverse();
  if (subtitle) {
    subtitle.textContent = `Latest ${rows.length} hours with status and totals`;
  }
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="muted-cell">No snapshots yet.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((snapshot) => {
    const nodesTotal = sumValues(snapshot.nodes);
    const gpusTotal = sumValues(snapshot.gpus);
    return `
      <tr>
        <td class="mono">${formatHour(snapshot.hour)}</td>
        <td>${statusTag(snapshot)}</td>
        <td>${formatInteger(nodesTotal)}</td>
        <td>${formatInteger(gpusTotal)}</td>
        <td class="${GPU_META.H100.cssClass}">${formatInteger(snapshot.gpus?.H100 || 0)}</td>
        <td class="${GPU_META.A100.cssClass}">${formatInteger(snapshot.gpus?.A100 || 0)}</td>
        <td class="${GPU_META.A100_40GB.cssClass}">${formatInteger(snapshot.gpus?.A100_40GB || 0)}</td>
        <td class="mono">${formatCurrency(snapshot.total_hourly_cost || 0)}</td>
      </tr>
    `;
  }).join("");
}

function updateLastRefreshed() {
  const el = document.getElementById("last-refreshed");
  if (el) {
    const now = new Date();
    el.textContent = `Fetched ${fmtHour.format(now)} local`;
  }
}

function renderAll() {
  renderMeta();
  renderHealth();
  renderPricing();
  renderKpis();
  renderRollingCards();
  renderGpuUsageChart();
  renderHourlyCostChart();
  renderCumulativeCostChart();
  renderPeriodChart();
  renderCostShareChart();
  renderRecentTable();
  const footerCount = document.getElementById("footer-snapshot-count");
  if (footerCount) {
    footerCount.textContent = formatInteger(state.snapshots.length);
  }
}

function setActiveButton(groupId, dataKey, value) {
  document.querySelectorAll(`#${groupId} button`).forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset[dataKey] === String(value));
  });
}

function bindControls() {
  document.querySelectorAll("#range-controls button").forEach((button) => {
    button.addEventListener("click", () => {
      state.rangeHours = Number(button.dataset.hours);
      setActiveButton("range-controls", "hours", state.rangeHours);
      renderGpuUsageChart();
      renderHourlyCostChart();
      renderCumulativeCostChart();
    });
  });

  document.querySelectorAll("#period-controls button").forEach((button) => {
    button.addEventListener("click", () => {
      state.period = button.dataset.period;
      setActiveButton("period-controls", "period", state.period);
      renderPeriodChart();
    });
  });

  const metricSelect = document.getElementById("period-metric");
  if (metricSelect) {
    metricSelect.addEventListener("change", () => {
      state.periodMetric = metricSelect.value;
      renderPeriodChart();
    });
  }

  document.querySelectorAll("#table-row-controls button").forEach((button) => {
    button.addEventListener("click", () => {
      state.tableRows = Number(button.dataset.rows);
      setActiveButton("table-row-controls", "rows", state.tableRows);
      renderRecentTable();
    });
  });

  document.querySelectorAll("#cumulative-range-controls button").forEach((button) => {
    button.addEventListener("click", () => {
      state.cumulativeRange = button.dataset.cumRange;
      setActiveButton("cumulative-range-controls", "cumRange", state.cumulativeRange);
      renderCumulativeCostChart();
    });
  });

  document.getElementById("refresh-now").addEventListener("click", async () => {
    const refreshButton = document.getElementById("refresh-now");
    const refreshLabel = refreshButton.querySelector(".refresh-label");
    refreshButton.disabled = true;
    refreshButton.classList.add("is-spinning");
    refreshLabel.textContent = "Refreshing\u2026";
    try {
      await loadData();
      renderAll();
      updateLastRefreshed();
    } catch (err) {
      console.error(err);
      document.getElementById("health-message").textContent = `Refresh failed: ${err.message}`;
    } finally {
      refreshButton.disabled = false;
      refreshButton.classList.remove("is-spinning");
      refreshLabel.textContent = "Refresh";
    }
  });
}

async function bootstrap() {
  bindControls();
  try {
    await loadData();
    renderAll();
    updateLastRefreshed();
  } catch (err) {
    console.error(err);
    const pill = document.getElementById("health-pill");
    const msg = document.getElementById("health-message");
    pill.classList.remove("health-neutral");
    pill.classList.add("health-error");
    pill.textContent = "Error";
    msg.textContent = `Failed to load dashboard data: ${err.message}`;
  }

  setInterval(async () => {
    try {
      await loadData();
      renderAll();
      updateLastRefreshed();
    } catch (err) {
      console.error("Auto-refresh failed", err);
    }
  }, 5 * 60 * 1000);
}

document.addEventListener("DOMContentLoaded", bootstrap);
