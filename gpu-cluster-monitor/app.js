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
        <td class="${GPU_META[gpuType].cssClass}">${GPU_META[gpuType].label}</td>
        <td class="mono">${row.instance_type || "-"}</td>
        <td class="mono">${formatCurrency(row.node_hourly_usd || 0)}</td>
        <td class="mono">${formatCurrency(row.gpu_hourly_usd || 0)}</td>
        <td>${pricing.name || "-"}</td>
      </tr>
    `;
  }).join("");

  const src = Array.isArray(pricing.source_links) ? pricing.source_links : [];
  links.innerHTML = src.map((item) => (
    `<li><a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.label}</a></li>`
  )).join("");
}

function buildKpiCards() {
  const kpis = state.aggregates?.kpis || {};
  const rolling24 = state.aggregates?.rolling?.["24h"] || {};
  const rolling7d = state.aggregates?.rolling?.["7d"] || {};
  const rolling30d = state.aggregates?.rolling?.["30d"] || {};
  const quality = state.aggregates?.quality || {};

  return [
    {
      title: "Current GPUs",
      value: formatInteger(kpis.current_gpus_total || 0),
      sub: `Nodes: ${formatInteger(kpis.current_nodes_total || 0)}`
    },
    {
      title: "Current Hourly Cost",
      value: formatCurrency(kpis.current_hourly_cost || 0),
      sub: "Based on active nodes now"
    },
    {
      title: "24h Total Cost",
      value: formatCurrency(rolling24.total_cost || 0),
      sub: `${formatInteger(rolling24.hours || 0)} hourly points`
    },
    {
      title: "7d Total Cost",
      value: formatCurrency(rolling7d.total_cost || 0),
      sub: `${formatInteger(rolling7d.hours || 0)} hourly points`
    },
    {
      title: "30d Total Cost",
      value: formatCurrency(rolling30d.total_cost || 0),
      sub: `${formatInteger(rolling30d.hours || 0)} hourly points`
    },
    {
      title: "All-Time Cost",
      value: formatCurrency(kpis.all_time_total_cost || 0),
      sub: "Accumulator from hourly snapshots"
    },
    {
      title: "All-Time GPU-Hours",
      value: formatInteger(kpis.all_time_total_gpu_hours || 0),
      sub: "Summed over H100/A100/A100-40GB"
    },
    {
      title: "Observed Coverage",
      value: `${formatDecimal(quality.coverage_pct || 0, 1)}%`,
      sub: `Observed=${formatInteger(quality.observed_hours || 0)} | Estimated=${formatInteger(quality.estimated_hours || 0)}`
    }
  ];
}

function renderKpis() {
  const container = document.getElementById("kpi-grid");
  const cards = buildKpiCards();
  container.innerHTML = cards.map((card) => `
    <article class="kpi-card">
      <div class="kpi-title">${card.title}</div>
      <div class="kpi-value">${card.value}</div>
      <div class="kpi-sub">${card.sub}</div>
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
  const existing = state.charts[chartKey];
  if (existing) {
    if (config.type && existing.config.type !== config.type) {
      existing.destroy();
      const ctx = document.getElementById(canvasId).getContext("2d");
      state.charts[chartKey] = new Chart(ctx, config);
      return;
    }
    existing.data = config.data;
    existing.options = config.options;
    existing.update();
    return;
  }
  const ctx = document.getElementById(canvasId).getContext("2d");
  state.charts[chartKey] = new Chart(ctx, config);
}

function baseChartOptions({ stacked = false, yLabel = "" } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        labels: { boxWidth: 12, usePointStyle: true }
      },
      tooltip: {
        callbacks: {
          label(context) {
            const raw = Number(context.raw || 0);
            if (yLabel === "USD") {
              return `${context.dataset.label}: ${formatCurrency(raw)}`;
            }
            return `${context.dataset.label}: ${formatDecimal(raw, 2)}`;
          }
        }
      }
    },
    scales: {
      x: {
        stacked,
        ticks: { maxTicksLimit: 12 },
        grid: { color: "rgba(25, 60, 100, 0.08)" }
      },
      y: {
        stacked,
        title: { display: Boolean(yLabel), text: yLabel },
        grid: { color: "rgba(25, 60, 100, 0.08)" }
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

function renderCumulativeCostChart() {
  const snapshots = getRangeSnapshots();
  const labels = snapshots.map((s) => fmtHour.format(toDate(s.hour)));
  let running = 0;
  const values = snapshots.map((s) => {
    running += Number(s.total_hourly_cost || 0);
    return Number(running.toFixed(2));
  });

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
  document.getElementById("period-chart-subtitle").textContent = `${prettyPeriod} totals by GPU type · ${prettyMetric}`;

  upsertChart("period", "period-chart", {
    type: "bar",
    data: { labels, datasets },
    options: baseChartOptions({ stacked: true, yLabel: unitLabel })
  });
}

function renderCostShareChart() {
  const costByType = state.aggregates?.all_time?.cost_by_type || {};
  const data = GPU_TYPES.map((gpuType) => Number(costByType[gpuType] || 0));
  upsertChart("costShare", "cost-share-chart", {
    type: "doughnut",
    data: {
      labels: GPU_TYPES.map((gpuType) => GPU_META[gpuType].label),
      datasets: [
        {
          data,
          backgroundColor: GPU_TYPES.map((gpuType) => GPU_META[gpuType].color),
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.label}: ${formatCurrency(context.raw)}`;
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
  const rows = [...state.snapshots].slice(-48).reverse();
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
  metricSelect.addEventListener("change", (event) => {
    state.periodMetric = event.target.value;
    renderPeriodChart();
  });
  metricSelect.addEventListener("input", (event) => {
    state.periodMetric = event.target.value;
    renderPeriodChart();
  });

  document.getElementById("refresh-now").addEventListener("click", async () => {
    const refreshButton = document.getElementById("refresh-now");
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing...";
    try {
      await loadData();
      renderAll();
    } catch (err) {
      console.error(err);
      document.getElementById("health-message").textContent = `Refresh failed: ${err.message}`;
    } finally {
      refreshButton.disabled = false;
      refreshButton.textContent = "Refresh";
    }
  });
}

async function bootstrap() {
  bindControls();
  try {
    await loadData();
    renderAll();
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
    } catch (err) {
      console.error("Auto-refresh failed", err);
    }
  }, 5 * 60 * 1000);
}

document.addEventListener("DOMContentLoaded", bootstrap);
