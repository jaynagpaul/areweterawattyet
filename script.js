const OWNER_ORDER = ["Google", "Microsoft", "Amazon", "China", "Meta", "Oracle", "xAI", "Other"];
const OWNER_COLORS = {
  Google: "#1a73e8",
  Microsoft: "#6788ff",
  Amazon: "#f26f21",
  China: "#ff5c39",
  Meta: "#d7ff58",
  Oracle: "#ffbf47",
  xAI: "#ab78ff",
  Other: "#a5acb8",
};

const GAUGE_MILESTONES = [1, 10, 100, 1000];
const PUE_MULTIPLIER = 1.45;
const TARGET_GW = 1000;
const EQUIVALENCE_DURATION_MS = 7000;

const formatNumber = (value, digits = 1) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);

const formatCompact = (value, digits = 1) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(value);

const quarterLabel = (date) => {
  const month = date.getUTCMonth() + 1;
  const quarter = Math.ceil(month / 3);
  return `Q${quarter} ${date.getUTCFullYear()}`;
};

function parseDate(value) {
  const [month, day, year] = value.split("/").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

async function loadData() {
  const response = await fetch("./Public%20view.csv");
  const csvText = await response.text();
  const lines = csvText.trim().split(/\r?\n/);
  const headers = lines[0].replace(/^\uFEFF/, "").split(",");
  const rows = lines.slice(1).map((line) => {
    const cols = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        cols.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    cols.push(current);

    return Object.fromEntries(headers.map((header, index) => [header, cols[index] ?? ""]));
  });

  return rows
    .map((row) => ({
      owner: row.Owner?.trim(),
      date: row["End date"] ? parseDate(row["End date"]) : null,
      mw: Number(row["Power in MW (median)"] || 0),
    }))
    .filter((row) => OWNER_ORDER.includes(row.owner) && row.date && Number.isFinite(row.mw) && row.mw > 0);
}

function aggregateSeries(rows) {
  const byDate = new Map();

  rows.forEach((row) => {
    const key = row.date.toISOString().slice(0, 10);
    if (!byDate.has(key)) {
      byDate.set(key, { date: row.date, values: Object.fromEntries(OWNER_ORDER.map((owner) => [owner, 0])) });
    }
    byDate.get(key).values[row.owner] += row.mw;
  });

  const series = [...byDate.values()].sort((a, b) => a.date - b.date);
  series.forEach((point) => {
    point.totalMw = OWNER_ORDER.reduce((sum, owner) => sum + point.values[owner], 0);
  });

  const latestComplete = [...series]
    .reverse()
    .find((point) => OWNER_ORDER.every((owner) => point.values[owner] > 0));

  return { series, latestComplete };
}

function renderGauge(currentGw) {
  const svg = document.querySelector("#gauge");
  const width = 520;
  const height = 330;
  const centerX = width / 2;
  const centerY = 278;
  const radius = 186;

  const toPolar = (angleDeg, r) => {
    const radians = (angleDeg * Math.PI) / 180;
    return {
      x: centerX + Math.cos(radians) * r,
      y: centerY + Math.sin(radians) * r,
    };
  };

  const describeArc = (startAngle, endAngle, r) => {
    const start = toPolar(startAngle, r);
    const end = toPolar(endAngle, r);
    const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
  };

  const logMin = Math.log10(1);
  const logMax = Math.log10(TARGET_GW);
  const progress = Math.max(0, Math.min(1, (Math.log10(currentGw) - logMin) / (logMax - logMin)));
  const startAngle = 180;
  const endAngle = 360;
  const valueAngle = startAngle + (endAngle - startAngle) * progress;

  svg.innerHTML = `
    <defs>
      <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#1a73e8" />
        <stop offset="55%" stop-color="#ff5c39" />
        <stop offset="100%" stop-color="#f26f21" />
      </linearGradient>
      <radialGradient id="gaugeHalo" cx="50%" cy="48%" r="54%">
        <stop offset="0%" stop-color="rgba(26,115,232,0.14)" />
        <stop offset="60%" stop-color="rgba(242,111,33,0.08)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0)" />
      </radialGradient>
      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="6" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <circle cx="${centerX}" cy="${centerY - 10}" r="148" fill="url(#gaugeHalo)" />
    <path d="${describeArc(startAngle, endAngle, radius)}" fill="none" stroke="rgba(20,20,20,0.12)" stroke-width="24" stroke-linecap="round" />
    <path d="${describeArc(startAngle, valueAngle, radius)}" fill="none" stroke="url(#gaugeGradient)" stroke-width="24" stroke-linecap="round" filter="url(#glow)" />
    <path d="${describeArc(startAngle, endAngle, radius - 36)}" fill="none" stroke="rgba(20,20,20,0.06)" stroke-width="1" />
    <path d="${describeArc(startAngle + 6, endAngle - 6, radius - 58)}" fill="none" stroke="rgba(20,20,20,0.08)" stroke-width="2" stroke-dasharray="3 7" />
  `;

  GAUGE_MILESTONES.forEach((milestone) => {
    const t = (Math.log10(milestone) - logMin) / (logMax - logMin);
    const angle = startAngle + (endAngle - startAngle) * t;
    const outer = toPolar(angle, radius + 16);
    const inner = toPolar(angle, radius - 16);
    const label = toPolar(angle, radius + 42);
    const isTarget = milestone === TARGET_GW;

    svg.insertAdjacentHTML(
      "beforeend",
      `
        <line x1="${inner.x}" y1="${inner.y}" x2="${outer.x}" y2="${outer.y}" stroke="${isTarget ? "#f26f21" : "rgba(20,20,20,0.34)"}" stroke-width="${isTarget ? 3 : 2}" />
        <text x="${label.x}" y="${label.y}" text-anchor="middle" fill="${isTarget ? "#f26f21" : "#666"}" font-size="13" class="gauge-tick-label">
          ${milestone === 1000 ? "1 TW" : `${milestone} GW`}
        </text>
      `,
    );
  });

  const needleBaseLeft = toPolar(valueAngle - 90, 10);
  const needleBaseRight = toPolar(valueAngle + 90, 10);
  const needleTip = toPolar(valueAngle, radius - 26);

  svg.insertAdjacentHTML(
    "beforeend",
    `
      <path d="M ${needleBaseLeft.x} ${needleBaseLeft.y} L ${needleTip.x} ${needleTip.y} L ${needleBaseRight.x} ${needleBaseRight.y} Z" fill="#edf2ff" opacity="0.95" />
      <circle cx="${centerX}" cy="${centerY}" r="16" fill="#141414" />
      <circle cx="${centerX}" cy="${centerY}" r="8" fill="#fffdf8" />
      <text x="${centerX}" y="${centerY - 44}" text-anchor="middle" fill="#666" font-size="13" letter-spacing="1.8">TERAWATT THRESHOLD</text>
      <text x="${centerX}" y="${centerY - 20}" text-anchor="middle" fill="#f26f21" font-size="12" letter-spacing="1.2">still not remotely boilerplate</text>
    `,
  );
}

function renderLegend() {
  const legend = document.querySelector("#legend");
  legend.innerHTML = OWNER_ORDER.map(
    (owner) => `
      <div class="legend-item">
        <span class="legend-chip" style="background:${OWNER_COLORS[owner]}"></span>
        <span>${owner}</span>
      </div>
    `,
  ).join("");
}

function renderChart(series) {
  const svg = document.querySelector("#ownership-chart");
  const tooltip = document.querySelector("#chart-tooltip");
  const width = 1120;
  const height = 520;
  const margin = { top: 20, right: 30, bottom: 62, left: 78 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const maxMw = Math.max(...series.map((point) => point.totalMw)) * 1.08;

  const xStep = innerWidth / series.length;
  const barWidth = Math.min(52, xStep * 0.72);
  const chartX = (index) => margin.left + xStep * index + (xStep - barWidth) / 2;
  const chartY = (value) => margin.top + innerHeight - (value / maxMw) * innerHeight;

  const horizontalTicks = 5;
  const gridLines = Array.from({ length: horizontalTicks + 1 }, (_, i) => {
    const value = (maxMw / horizontalTicks) * i;
    const y = chartY(value);
    return `
      <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="rgba(20,20,20,0.08)" />
      <text x="${margin.left - 14}" y="${y + 4}" text-anchor="end" fill="#666" font-size="12">${formatNumber(value / 1000, 0)} GW</text>
    `;
  }).join("");

  const xLabels = series.map((point, index) => {
    const show = index === 0 || index === series.length - 1 || point.date.getUTCMonth() === 11;
    if (!show) return "";
    return `<text x="${chartX(index) + barWidth / 2}" y="${height - 22}" text-anchor="middle" fill="#666" font-size="12">${quarterLabel(point.date)}</text>`;
  }).join("");

  const bars = series
    .map((point, index) => {
      let running = 0;
      const segments = OWNER_ORDER.map((owner) => {
        const value = point.values[owner];
        const yTop = chartY(running + value);
        const yBottom = chartY(running);
        running += value;
        return `
          <rect
            x="${chartX(index)}"
            y="${yTop}"
            width="${barWidth}"
            height="${Math.max(0, yBottom - yTop)}"
            rx="4"
            fill="${OWNER_COLORS[owner]}"
            opacity="0.92"
            stroke="rgba(20,20,20,0.1)"
            stroke-width="1"
          />
        `;
      }).join("");

      return `
        <g data-point-index="${index}" class="chart-column">
          ${segments}
          <rect x="${chartX(index) - xStep * 0.14}" y="${margin.top}" width="${barWidth + xStep * 0.28}" height="${innerHeight}" fill="transparent" />
        </g>
      `;
    })
    .join("");

  svg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="transparent" />
    ${gridLines}
    <line x1="${margin.left}" y1="${margin.top + innerHeight}" x2="${width - margin.right}" y2="${margin.top + innerHeight}" stroke="rgba(20,20,20,0.18)" />
    ${bars}
    ${xLabels}
    <text x="${margin.left}" y="${margin.top - 6}" fill="#666" font-size="12">Cumulative chip power (MW)</text>
  `;

  const columns = [...svg.querySelectorAll(".chart-column")];
  const setTooltip = (index, clientX, clientY) => {
    const point = series[index];
    const sortedOwners = [...OWNER_ORDER]
      .map((owner) => ({ owner, value: point.values[owner] }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value);

    tooltip.innerHTML = `
      <div class="tooltip-date">${quarterLabel(point.date)}</div>
      <div class="tooltip-total">Total: <strong>${formatNumber(point.totalMw / 1000, 2)} GW</strong></div>
      ${sortedOwners
        .map(
          ({ owner, value }) => `
            <div class="tooltip-row">
              <span>${owner}</span>
              <strong>${formatNumber(value / 1000, 2)} GW</strong>
            </div>
          `,
        )
        .join("")}
    `;

    tooltip.hidden = false;
    const bounds = svg.getBoundingClientRect();
    const x = clientX - bounds.left + 18;
    const y = clientY - bounds.top - 18;
    tooltip.style.left = `${Math.min(x, bounds.width - 240)}px`;
    tooltip.style.top = `${Math.max(20, y)}px`;
  };

  columns.forEach((column, index) => {
    column.addEventListener("mouseenter", (event) => {
      columns.forEach((item) => {
        item.style.opacity = "0.42";
      });
      column.style.opacity = "1";
      setTooltip(index, event.clientX, event.clientY);
    });

    column.addEventListener("mousemove", (event) => setTooltip(index, event.clientX, event.clientY));
    column.addEventListener("mouseleave", () => {
      columns.forEach((item) => {
        item.style.opacity = "1";
      });
      tooltip.hidden = true;
    });
  });
}

function animateValue(element, from, to, formatter, duration = 900) {
  const start = performance.now();

  function frame(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - progress) ** 3;
    const value = from + (to - from) * eased;
    element.textContent = formatter(value);
    if (progress < 1) requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function startEquivalenceCycle(currentGw) {
  const currentMw = currentGw * 1000;
  const cards = [
    {
      label: "NYC apartments",
      value: (currentGw * 1_000_000) / 0.68,
      unit: "",
      formatter: (value) => formatCompact(value, 1),
      description: "At ~680 W average draw per apartment, this is city-scale domestic demand. That's roughly 8 full New York Cities worth of residential load.",
    },
    {
      label: "electric kettles boiling",
      value: (currentMw * 1_000) / 1.5,
      unit: " live",
      formatter: (value) => formatCompact(value, 1),
      description: "How many 1.5 kW kettles you could run simultaneously. More than one per person alive on Earth — before someone from the grid operator calls.",
    },
    {
      label: "Frontier supercomputers",
      value: (currentGw * 1_000_000) / 21,
      unit: "",
      formatter: (value) => formatCompact(value, 0),
      description: "Frontier at Oak Ridge — the world's fastest supercomputer — draws ~21 MW. The entire AI chip estate represents this many Frontiers worth of installed power.",
    },
    {
      label: "Icelands of electricity",
      // Iceland generates ~19 TWh/year = ~2.17 GW average continuous
      value: currentGw / 2.17,
      unit: "×",
      formatter: (value) => formatNumber(value, 1),
      description: "Iceland's entire grid averages about 2.17 GW. AI chip infrastructure has already lapped it nearly a dozen times over.",
    },
    {
      label: "offshore wind turbines",
      value: (currentMw * 1_000) / 15_000,
      unit: "",
      formatter: (value) => formatNumber(value, 0),
      description: "Equivalent continuous output from modern 15 MW offshore wind turbines. You can picture the horizon getting crowded fast.",
    },
    {
      label: "nuclear reactors needed",
      // Large nuclear power stations average ~1 GW net output
      value: currentGw,
      unit: "",
      formatter: (value) => formatNumber(value, 0),
      description: "A large nuclear power station outputs roughly 1 GW net. This is how many you would need to dedicate entirely to AI compute infrastructure today.",
    },
    {
      label: "human brains this could power",
      // Human brain runs on ~20 W
      value: (currentGw * 1_000_000_000) / 20,
      unit: "",
      formatter: (value) => formatCompact(value, 1),
      description: "The human brain runs on about 20 W. This infrastructure could theoretically power close to a billion minds — roughly 1 in 8 people alive today.",
    },
    {
      label: "average US homes",
      // US average household draws ~1.23 kW continuously (EIA: 10,791 kWh/yr)
      value: (currentGw * 1_000_000) / 1.23,
      unit: "",
      formatter: (value) => formatCompact(value, 1),
      description: "The average American home draws about 1.23 kW around the clock. This is how many homes you could run entirely on AI chip infrastructure power.",
    },
    {
      label: "× the Bitcoin network",
      // Bitcoin mining: ~120 TWh/yr ÷ 8,760 hrs = ~13.7 GW (Cambridge BECI estimate)
      value: currentGw / 13.7,
      unit: "×",
      formatter: (value) => formatNumber(value, 2),
      description: "Bitcoin mining consumes an estimated ~120 TWh per year (~13.7 GW). AI chip infrastructure has quietly overtaken it — with far less public debate about the energy footprint.",
    },
  ];

  const labelEl = document.querySelector("#equivalence-label");
  const numberEl = document.querySelector("#equivalence-number");
  const unitEl = document.querySelector("#equivalence-unit");
  const descEl = document.querySelector("#equivalence-description");
  const indexEl = document.querySelector("#equivalence-index");
  const progressEl = document.querySelector("#equivalence-progress-fill");

  let currentIndex = 0;
  let previousValue = 0;
  let startedAt = performance.now();

  function showCard(index) {
    const card = cards[index];
    labelEl.textContent = card.label;
    descEl.textContent = card.description;
    unitEl.textContent = card.unit;
    indexEl.textContent = String(index + 1).padStart(2, "0");
    animateValue(numberEl, previousValue, card.value, card.formatter, 1000);
    previousValue = card.value;
  }

  function tick(now) {
    const elapsed = now - startedAt;
    const progress = Math.min(1, elapsed / EQUIVALENCE_DURATION_MS);
    progressEl.style.width = `${progress * 100}%`;

    if (elapsed >= EQUIVALENCE_DURATION_MS) {
      currentIndex = (currentIndex + 1) % cards.length;
      startedAt = now;
      progressEl.style.width = "0%";
      showCard(currentIndex);
    }

    requestAnimationFrame(tick);
  }

  showCard(currentIndex);
  requestAnimationFrame(tick);
}

function renderProgressBar(facilityGw) {
  const logMin = Math.log10(1);
  const logMax = Math.log10(TARGET_GW);
  const pct = Math.max(0, Math.min(100, ((Math.log10(facilityGw) - logMin) / (logMax - logMin)) * 100));

  const fillEl = document.querySelector("#progress-fill");
  const markerEl = document.querySelector("#progress-marker");
  const valueEl = document.querySelector("#progress-value");
  const noteEl = document.querySelector("#progress-note");
  const barEl = document.querySelector("#progress-bar");

  fillEl.style.width = `${pct}%`;
  markerEl.style.left = `${pct}%`;
  barEl.setAttribute("aria-valuenow", facilityGw.toFixed(1));

  const gwFormatted = facilityGw >= 100
    ? formatNumber(facilityGw, 0)
    : formatNumber(facilityGw, 1);
  valueEl.textContent = `${gwFormatted} GW`;

  const remaining = TARGET_GW - facilityGw;
  noteEl.textContent = `${formatNumber(remaining, 0)} GW away from one terawatt — a milestone no single grid operator has crossed.`;
}

function populateHeadline(snapshot) {
  const facilityGw = (snapshot.totalMw / 1000) * PUE_MULTIPLIER;
  renderProgressBar(facilityGw);
  startEquivalenceCycle(facilityGw);
}

async function init() {
  const rows = await loadData();
  const { latestComplete } = aggregateSeries(rows);
  populateHeadline(latestComplete);
}

init().catch((error) => {
  console.error(error);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div style="position:fixed;bottom:16px;left:16px;padding:12px 14px;border:1px solid rgba(255,255,255,0.12);background:#111827;color:#fff;border-radius:12px;z-index:999">Failed to load local CSV.</div>`,
  );
});
