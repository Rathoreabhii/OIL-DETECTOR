import "leaflet/dist/leaflet.css";
import "./styles.css";
import { createMap } from "./map.js";
import { renderPanel, vesselKey } from "./panel.js";
import { bindUpload } from "./upload.js";
import * as sea from "./sea.js";
import { getTHours, setTHours, onTHours, timeRange, formatTHours } from "./time.js";

const DEFAULT_CASE_ID = "case_001";

const app = document.querySelector("#app");
const root = app.querySelector(".app");
const banner = app.querySelector("#banner");
const panelEl = app.querySelector("#panel-body");
const panelFoot = app.querySelector("#panel-foot");
const casePick = app.querySelector("#case-pick");
const caseSelect = app.querySelector("#case-select");
const tabsActive = app.querySelector("#tabs-active");
const tabButtons = [...app.querySelectorAll('[role="tab"]')];
const seaNote = app.querySelector("#sea-note");
const views = {
  map: app.querySelector("#view-map"),
  sea: app.querySelector("#view-sea"),
  upload: app.querySelector("#view-upload"),
};

const TAB_ORDER = ["map", "sea", "upload"];

let caseData = null;
let selectedKey = null;
let mapApi = null;
let formula = null;
let currentCaseId = DEFAULT_CASE_ID;
let loadGen = 0;
const localCases = new Map();

function unwrapCase(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.slick || payload.vessels || payload.sar || payload.drift) return payload;
  if (payload.case && typeof payload.case === "object") return payload.case;
  if (payload.data && typeof payload.data === "object") return payload.data;
  return payload;
}

function unwrapCases(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.cases)) return payload.cases;
  return [];
}

function caseLabel(entry) {
  const id = String(entry?.id ?? "");
  const title = entry?.title ? String(entry.title) : "";
  if (title && title !== id) return `${id} · ${title}`;
  return id || "Case";
}

function scoringFromCase(data) {
  const s = data?.scoring;
  if (typeof s === "string") return s.trim() || null;
  if (s && typeof s === "object" && typeof s.formula === "string") {
    return s.formula.trim() || null;
  }
  return null;
}

function setBanner(kind, text) {
  if (!text) {
    banner.hidden = true;
    banner.textContent = "";
    banner.removeAttribute("role");
    banner.className = "banner";
    return;
  }
  banner.hidden = false;
  banner.className = `banner is-${kind}`;
  banner.textContent = text;
  banner.setAttribute("role", kind === "error" ? "alert" : "status");
}

function setTab(name, { instant = false } = {}) {
  const index = Math.max(0, TAB_ORDER.indexOf(name));
  const width = 100 / TAB_ORDER.length;
  tabsActive.style.transitionDuration = instant ? "0ms" : "";
  tabsActive.style.setProperty("--clip-left", `${index * width}%`);
  tabsActive.style.setProperty("--clip-right", `${(TAB_ORDER.length - 1 - index) * width}%`);

  root.dataset.tab = name;
  tabButtons.forEach((btn) => {
    const on = btn.dataset.tab === name;
    btn.setAttribute("aria-selected", on ? "true" : "false");
    btn.tabIndex = on ? 0 : -1;
  });
  Object.entries(views).forEach(([key, el]) => {
    el.hidden = key !== name;
  });
  if (name === "map" && mapApi) {
    requestAnimationFrame(() => mapApi.invalidate());
  }
  if (name === "sea") {
    const vid = document.getElementById("sea-video");
    if (vid) {
      vid.muted = true;
      vid.defaultMuted = true;
      vid.volume = 0;
      vid.loop = true;
      const play = vid.play();
      if (play && typeof play.catch === "function") play.catch(() => {});
    }
    sea.render(caseData);
  } else {
    sea.stop();
  }
}

function selectVessel(key) {
  selectedKey = key;
  if (mapApi) mapApi.setSelected(key);
  renderPanel(panelEl, {
    caseData,
    selectedKey,
    formula,
    loading: root.dataset.state === "loading",
    error: root.dataset.state === "error",
    onSelect: selectVessel,
  });
}

function paint() {
  renderPanel(panelEl, {
    caseData,
    selectedKey,
    formula,
    loading: root.dataset.state === "loading",
    error: root.dataset.state === "error",
    onSelect: selectVessel,
  });
  if (mapApi) {
    if (caseData && root.dataset.state === "ready") mapApi.render(caseData, selectedKey);
    else mapApi.render(null, null);
  }
  if (caseData?.id) {
    seaNote.textContent = `Case ${caseData.id}. Touch a ship, then drag Time.`;
  } else {
    seaNote.textContent = "";
  }
  if (root.dataset.tab === "sea") sea.render(caseData);
}

function paintFooter(detector) {
  if (!detector) {
    panelFoot.hidden = true;
    panelFoot.replaceChildren();
    return;
  }
  panelFoot.hidden = false;
  const label = document.createElement("span");
  label.className = "foot-k";
  label.textContent = "Detector";
  const value = document.createElement("span");
  value.className = "foot-v";
  value.textContent = detector;
  panelFoot.replaceChildren(label, value);
}

function syncCaseSelector(cases, selectedId) {
  const list = cases.filter((c) => c && c.id);
  if (list.length <= 1) {
    casePick.hidden = true;
    caseSelect.replaceChildren();
    return;
  }
  caseSelect.replaceChildren();
  for (const entry of list) {
    const opt = document.createElement("option");
    opt.value = String(entry.id);
    opt.textContent = caseLabel(entry);
    caseSelect.append(opt);
  }
  const ids = list.map((c) => String(c.id));
  caseSelect.value = ids.includes(String(selectedId)) ? String(selectedId) : ids[0];
  casePick.hidden = false;
}

async function listCases() {
  try {
    const res = await fetch("/api/cases", { cache: "no-store" });
    if (!res.ok) return [];
    return unwrapCases(await res.json()).filter((c) => c && c.id);
  } catch {
    return [];
  }
}

async function loadHealth() {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const detector = typeof data?.detector === "string" ? data.detector.trim() : "";
    paintFooter(detector || null);
  } catch {
    paintFooter(null);
  }
}

async function fetchFormula() {
  try {
    const res = await fetch("/api/score/formula", { cache: "no-store" });
    if (!res.ok) return null;
    const payload = await res.json();
    if (typeof payload?.formula === "string" && payload.formula.trim()) {
      return payload.formula.trim();
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveFormula(data) {
  return scoringFromCase(data) ?? (await fetchFormula());
}

function fillEnv(data) {
  const form = app.querySelector("#analyze-form");
  if (!form) return;
  const wind = data?.environment?.wind ?? {};
  const current = data?.environment?.current ?? {};
  if (form.wind_speed) form.wind_speed.value = wind.speed_ms ?? "";
  if (form.wind_toward) form.wind_toward.value = wind.toward_deg ?? "";
  if (form.current_speed) form.current_speed.value = current.speed_ms ?? "";
  if (form.current_toward) form.current_toward.value = current.toward_deg ?? "";
}

function syncDeskTime(data) {
  const slider = app.querySelector("#desk-time");
  const seaSlider = app.querySelector("#sea-time");
  const { min, max } = timeRange(data);
  [slider, seaSlider].forEach((el) => {
    if (!el) return;
    el.min = String(min);
    el.max = String(max);
    el.step = "0.1";
  });
  let t = getTHours();
  if (t < min || t > max) t = setTHours(0);
  if (slider) slider.value = String(t);
  if (seaSlider) seaSlider.value = String(t);
  const out = app.querySelector("#desk-time-val");
  const seaOut = app.querySelector("#sea-time-val");
  if (out) out.textContent = formatTHours(t);
  if (seaOut) seaOut.textContent = formatTHours(t);
}

function setPipeline(data) {
  const source = String(data?.slick?.source || "").toLowerCase();
  const fromUpload = source.includes("baseline") || source.includes("upload");
  const steps = {
    ingest: Boolean(data?.id),
    detect: Boolean(data?.pipeline?.detect) || fromUpload,
    drift: Array.isArray(data?.drift?.hindcast) && data.drift.hindcast.length > 0,
    ais: Array.isArray(data?.vessels) && data.vessels.length > 0,
    score: Array.isArray(data?.vessels) && data.vessels.some((v) => v.score != null),
  };
  if (data?.pipeline && typeof data.pipeline === "object") {
    if ("detect" in data.pipeline) steps.detect = Boolean(data.pipeline.detect);
    if ("drift" in data.pipeline) steps.drift = Boolean(data.pipeline.drift);
    if ("ais" in data.pipeline) steps.ais = Boolean(data.pipeline.ais);
    if ("score" in data.pipeline) steps.score = Boolean(data.pipeline.score);
  }
  app.querySelectorAll("#pipeline [data-step]").forEach((el) => {
    el.classList.toggle("is-on", Boolean(steps[el.dataset.step]));
  });
}

function applyCase(data, { caseId } = {}) {
  caseData = data;
  currentCaseId = caseId || data?.id || currentCaseId;
  root.dataset.state = "ready";
  setBanner(null);
  if (data?.id) localCases.set(String(data.id), data);
  const vessels = Array.isArray(data.vessels) ? data.vessels : [];
  const first = vessels.find((v) => Number(v.rank) === 1) ?? vessels[0];
  selectedKey = first ? vesselKey(first, 0) : null;
  if (caseSelect.options.length) {
    const values = [...caseSelect.options].map((o) => o.value);
    if (values.includes(String(currentCaseId))) caseSelect.value = String(currentCaseId);
  }
  fillEnv(data);
  syncDeskTime(data);
  setPipeline(data);
}

export function setCase(data) {
  const unwrapped = unwrapCase(data);
  if (
    !unwrapped ||
    typeof unwrapped !== "object" ||
    (!unwrapped.slick && !Array.isArray(unwrapped.vessels) && !unwrapped.sar && !unwrapped.id)
  ) {
    setBanner("error", "backend Phase B endpoint returned no case JSON.");
    return;
  }
  loadGen += 1;
  formula = scoringFromCase(unwrapped);
  const id = String(unwrapped.id || "upload_001");
  localCases.set(id, unwrapped);
  const values = [...caseSelect.options].map((o) => o.value);
  if (!values.includes(id)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = caseLabel(unwrapped);
    caseSelect.append(opt);
  }
  if (caseSelect.options.length > 1) casePick.hidden = false;
  applyCase(unwrapped, { caseId: id });
  paint();
  setTab("map");
  if (!formula) {
    fetchFormula().then((next) => {
      if (caseData !== unwrapped) return;
      formula = next;
      paint();
    });
  }
}

window.setCase = setCase;

async function loadCase(caseId) {
  const id = String(caseId || DEFAULT_CASE_ID);
  const cached = localCases.get(id);
  if (cached) {
    loadGen += 1;
    formula = scoringFromCase(cached);
    applyCase(cached, { caseId: id });
    paint();
    if (!formula) {
      fetchFormula().then((next) => {
        if (caseData !== cached) return;
        formula = next;
        paint();
      });
    }
    return;
  }
  const token = ++loadGen;
  currentCaseId = id;
  caseSelect.disabled = true;
  root.dataset.state = "loading";
  caseData = null;
  selectedKey = null;
  formula = null;
  setBanner("loading", `Loading ${id}…`);
  paint();
  try {
    const res = await fetch(`/api/cases/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const data = unwrapCase(payload);
    if (!data || typeof data !== "object") throw new Error("empty case");
    if (!data.slick && !Array.isArray(data.vessels) && !data.sar && !data.id) {
      throw new Error("empty case");
    }
    const nextFormula = await resolveFormula(data);
    if (token !== loadGen) return;
    applyCase(data, { caseId: id });
    formula = nextFormula;
    paint();
  } catch {
    if (token !== loadGen) return;
    caseData = null;
    selectedKey = null;
    formula = null;
    root.dataset.state = "error";
    setBanner("error", "Start backend on port 8000");
    paint();
  } finally {
    if (token === loadGen) caseSelect.disabled = false;
  }
}

async function boot() {
  const [, cases] = await Promise.all([loadHealth(), listCases()]);
  let id = DEFAULT_CASE_ID;
  if (cases.length) {
    const ids = cases.map((c) => String(c.id));
    if (!ids.includes(id)) id = ids[0];
  }
  currentCaseId = id;
  syncCaseSelector(cases, id);
  await loadCase(id);
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => setTab(btn.dataset.tab));
});

app.querySelector('[role="tablist"]').addEventListener("keydown", (e) => {
  const i = tabButtons.findIndex((b) => b.dataset.tab === root.dataset.tab);
  let next = i;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % tabButtons.length;
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + tabButtons.length) % tabButtons.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = tabButtons.length - 1;
  else return;
  e.preventDefault();
  const name = tabButtons[next].dataset.tab;
  setTab(name, { instant: true });
  tabButtons[next].focus();
});

caseSelect.addEventListener("change", () => {
  const id = caseSelect.value;
  if (id && id !== currentCaseId) loadCase(id);
});

bindUpload(app.querySelector("#upload-form"), { setCase });

const analyzeForm = app.querySelector("#analyze-form");
const analyzeBtn = app.querySelector("#run-analyze");
const analyzeStatus = app.querySelector("#analyze-status");
const IDLE_ANALYZE = "Run investigation";
const BUSY_ANALYZE = "Running drift → score…";

function setAnalyzeStatus(kind, text) {
  if (!analyzeStatus) return;
  if (!text) {
    analyzeStatus.hidden = true;
    analyzeStatus.textContent = "";
    analyzeStatus.className = "desk-status";
    return;
  }
  analyzeStatus.hidden = false;
  analyzeStatus.className = kind === "error" ? "desk-status is-error" : "desk-status";
  analyzeStatus.textContent = text;
}

analyzeForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = currentCaseId || caseData?.id;
  if (!id) {
    setAnalyzeStatus("error", "No case loaded.");
    return;
  }
  if (analyzeBtn) {
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = BUSY_ANALYZE;
  }
  setAnalyzeStatus(null, "Recomputing leeway drift and ranks…");
  try {
    const res = await fetch(`/api/cases/${encodeURIComponent(id)}/analyze`, {
      method: "POST",
      body: new FormData(analyzeForm),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 240);
      try {
        const json = JSON.parse(text);
        if (typeof json.detail === "string") detail = json.detail;
      } catch {
        /* keep */
      }
      throw new Error(detail || `HTTP ${res.status}`);
    }
    const payload = JSON.parse(text);
    const data = unwrapCase(payload);
    if (!data?.slick && !Array.isArray(data?.vessels)) throw new Error("empty case");
    formula = scoringFromCase(data) ?? formula;
    applyCase(data, { caseId: String(data.id || id) });
    paint();
    mapApi?.setTime(getTHours());
    setAnalyzeStatus(null, "Drift and ranks updated. Detect was not re-run.");
  } catch (err) {
    setAnalyzeStatus("error", err?.message || "Analyze failed. Is the API on port 8000?");
  } finally {
    if (analyzeBtn) {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = IDLE_ANALYZE;
    }
  }
});

function bindHourSlider(el) {
  if (!el) return;
  el.addEventListener("input", () => {
    setTHours(el.value);
  });
}
bindHourSlider(app.querySelector("#desk-time"));
bindHourSlider(app.querySelector("#sea-time"));

onTHours((t) => {
  const desk = app.querySelector("#desk-time");
  const seaEl = app.querySelector("#sea-time");
  if (desk && desk.value !== String(t)) desk.value = String(t);
  if (seaEl && seaEl.value !== String(t)) seaEl.value = String(t);
  const out = app.querySelector("#desk-time-val");
  const seaOut = app.querySelector("#sea-time-val");
  if (out) out.textContent = formatTHours(t);
  if (seaOut) seaOut.textContent = formatTHours(t);
  mapApi?.setTime(t);
});

app.querySelector("#map-layers")?.addEventListener("change", (e) => {
  const input = e.target;
  if (input?.name !== "layer") return;
  mapApi?.setLayer(input.value, input.checked);
});

mapApi = createMap(app.querySelector("#map"), { onSelect: selectVessel });
setTab("map", { instant: true });
paint();
boot().then(() => {
  requestAnimationFrame(() => mapApi?.invalidate());
});
