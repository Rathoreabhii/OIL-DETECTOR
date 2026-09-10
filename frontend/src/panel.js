export function vesselKey(vessel, index) {
  if (!vessel || typeof vessel !== "object") return String(index);
  return String(vessel.mmsi ?? vessel.id ?? vessel.name ?? index);
}

export function vesselName(vessel, index) {
  if (!vessel || typeof vessel !== "object") return `Vessel ${index + 1}`;
  if (vessel.name) return String(vessel.name);
  if (vessel.ship_name) return String(vessel.ship_name);
  if (vessel.mmsi) return `MMSI ${vessel.mmsi}`;
  return `Vessel ${index + 1}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function compass(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n)) return null;
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const i = Math.round(((n % 360) + 360) % 360 / 22.5) % 16;
  return dirs[i];
}

function fmtNum(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(digits);
}

function fmtDeg(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const dir = compass(n);
  return dir ? `${n.toFixed(0)}° ${dir}` : `${n.toFixed(0)}°`;
}

function fmtType(value) {
  if (!value) return "—";
  return String(value).replace(/_/g, " ");
}

function fmtWhen(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().replace(".000", "").replace("T", " ").replace("Z", "Z");
}

function fmtConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n >= 0 && n <= 1) return `${Math.round(n * 100)}%`;
  return String(value);
}

function fmtScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(3);
}

function dash(value) {
  return value == null || value === "" ? "—" : value;
}

function rankedVessels(caseData) {
  const list = Array.isArray(caseData?.vessels) ? caseData.vessels.slice() : [];
  list.sort((a, b) => {
    const ra = Number(a.rank);
    const rb = Number(b.rank);
    if (Number.isFinite(ra) && Number.isFinite(rb)) return ra - rb;
    return Number(b.score ?? 0) - Number(a.score ?? 0);
  });
  return list;
}

function dlRow(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(dash(value))}</dd></div>`;
}

function envBlock(env) {
  const wind = env?.wind ?? {};
  const current = env?.current ?? {};
  const windSpeed = fmtNum(wind.speed_ms, 1);
  const curSpeed = fmtNum(current.speed_ms, 2);
  const windFrom = fmtDeg(wind.from_deg);
  const windToward = fmtDeg(wind.toward_deg);
  const curToward = fmtDeg(current.toward_deg);

  const windBits = [];
  if (windSpeed) windBits.push(`${windSpeed} m/s`);
  if (windFrom) windBits.push(`from ${windFrom}`);
  if (windToward) windBits.push(`toward ${windToward}`);

  const curBits = [];
  if (curSpeed) curBits.push(`${curSpeed} m/s`);
  if (curToward) curBits.push(`toward ${curToward}`);

  return `
    <section class="block">
      <h2>Environment</h2>
      <dl class="facts">
        ${dlRow("Wind (atmospheric)", windBits.length ? windBits.join(" · ") : null)}
        ${dlRow("Current (water transport)", curBits.length ? curBits.join(" · ") : null)}
      </dl>
    </section>
  `;
}

function originBlock(caseData) {
  const hind = Array.isArray(caseData?.drift?.hindcast) ? caseData.drift.hindcast : [];
  const first = hind[0];
  const lat = first ? fmtNum(first.lat, 3) : null;
  const lon = first ? fmtNum(first.lon, 3) : null;
  const method = caseData?.drift?.method;
  const window = caseData?.drift?.origin_window;
  const windowText =
    window?.start && window?.end ? `${fmtWhen(window.start)} → ${fmtWhen(window.end)}` : null;
  return `
    <section class="block">
      <h2>Leeway origin</h2>
      <dl class="facts">
        ${dlRow("Lat, lon", lat && lon ? `${lat}, ${lon}` : null)}
        ${dlRow("Window", windowText)}
        ${dlRow("Method", method)}
      </dl>
    </section>
  `;
}

function slickBlock(slick) {
  const area = fmtNum(slick?.area_km2, 2);
  const age = fmtNum(slick?.age_hours_est, 1);
  return `
    <section class="block">
      <h2>Incident</h2>
      <dl class="facts">
        ${dlRow("Area", area ? `${area} km²` : null)}
        ${dlRow("Confidence", fmtConfidence(slick?.confidence))}
        ${dlRow("Age", age ? `${age} h estimated` : null)}
        ${dlRow("Source", slick?.source ?? null)}
      </dl>
    </section>
  `;
}

function vesselTable(vessels, selectedKey) {
  if (!vessels.length) {
    return `<p class="empty">No vessels in the case payload.</p>`;
  }
  const rows = vessels
    .map((v, i) => {
      const key = vesselKey(v, i);
      const selected = key === selectedKey;
      return `
        <tr data-vessel="${escapeHtml(key)}" tabindex="0" aria-selected="${selected ? "true" : "false"}" class="${selected ? "is-selected" : ""}">
          <td class="num">${escapeHtml(v.rank ?? i + 1)}</td>
          <td>${escapeHtml(vesselName(v, i))}</td>
          <td>${escapeHtml(fmtType(v.type))}</td>
          <td class="num">${escapeHtml(fmtScore(v.score))}</td>
        </tr>
      `;
    })
    .join("");
  return `
    <div class="table-wrap">
      <table class="ranks">
        <thead>
          <tr>
            <th class="num">Rank</th>
            <th>Name</th>
            <th>Type</th>
            <th class="num">Score</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function selectedBlock(vessels, selectedKey) {
  const idx = vessels.findIndex((v, i) => vesselKey(v, i) === selectedKey);
  if (idx < 0) {
    return `
      <section class="block reasons">
        <h2>Selected vessel</h2>
        <p class="empty">Click a vessel on the map or a row in the table to see why it ranked.</p>
      </section>
    `;
  }
  const v = vessels[idx];
  const reasons = Array.isArray(v.reasons) ? v.reasons.filter(Boolean) : [];
  const reasonList = reasons.length
    ? `<ul class="reason-list">${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`
    : `<p class="empty">No reasons attached for this vessel.</p>`;
  const extra = [];
  if (v.mmsi) extra.push(`MMSI ${v.mmsi}`);
  if (v.components?.closest_km != null) extra.push(`${Number(v.components.closest_km).toFixed(1)} km closest`);
  return `
    <section class="block reasons">
      <h2>${escapeHtml(vesselName(v, idx))}</h2>
      <p class="meta">${escapeHtml(fmtType(v.type))} · score ${escapeHtml(fmtScore(v.score))}${extra.length ? ` · ${escapeHtml(extra.join(" · "))}` : ""}</p>
      ${reasonList}
    </section>
  `;
}

function skeleton() {
  return `
    <div class="block">
      <div class="skel skel-title"></div>
      <div class="skel"></div>
      <div class="skel"></div>
      <div class="skel short"></div>
    </div>
    <div class="block">
      <div class="skel skel-title"></div>
      <div class="skel"></div>
      <div class="skel"></div>
    </div>
  `;
}

export function renderPanel(el, { caseData, selectedKey, formula, loading, error, onSelect }) {
  if (loading) {
    el.innerHTML = skeleton();
    return;
  }

  if (error || !caseData) {
    el.innerHTML = `
      <section class="block">
        <h2>Case</h2>
        <p class="error-copy">Start backend on port 8000. Vessel scores are not shown while the API is down.</p>
      </section>
    `;
    return;
  }

  const vessels = rankedVessels(caseData);
  const observed = fmtWhen(caseData.observed_at);
  const method = caseData.drift?.method;
  const window = caseData.drift?.origin_window;
  const windowText =
    window?.start && window?.end ? `${fmtWhen(window.start)} → ${fmtWhen(window.end)}` : null;

  el.innerHTML = `
    <header class="case-head">
      <h2>${escapeHtml(caseData.title || caseData.id || "Case")}</h2>
      <p>${[caseData.id, caseData.region, observed].filter(Boolean).map(escapeHtml).join(" · ")}</p>
    </header>
    ${slickBlock(caseData.slick)}
    ${originBlock(caseData)}
    ${envBlock(caseData.environment)}
    ${vessels[0] ? `
    <section class="block">
      <h2>Top candidate</h2>
      <p class="meta">${escapeHtml(vesselName(vessels[0], 0))} · ${escapeHtml(fmtType(vessels[0].type))} · ${escapeHtml(fmtScore(vessels[0].score))}</p>
    </section>` : ""}
    <section class="block">
      <h2>Ranked vessels</h2>
      ${windowText ? `<p class="meta">Origin window ${escapeHtml(windowText)}</p>` : ""}
      ${method ? `<p class="meta">${escapeHtml(method)}</p>` : ""}
      ${vesselTable(vessels, selectedKey)}
      ${formula ? `<p class="formula">${escapeHtml(formula)}</p>` : ""}
    </section>
    ${selectedBlock(vessels, selectedKey)}
  `;

  el.querySelectorAll("[data-vessel]").forEach((row) => {
    const fire = () => {
      if (typeof onSelect === "function") onSelect(row.dataset.vessel);
    };
    row.addEventListener("click", fire);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fire();
      }
    });
  });
}
