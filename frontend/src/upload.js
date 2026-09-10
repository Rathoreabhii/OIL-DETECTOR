const INVESTIGATE_URL = "/api/investigate";
const IDLE_LABEL = "Run detect → drift → score";
const BUSY_LABEL = "Running detect → drift → score…";
const SAR_COPY =
  "Sentinel-1 GRD / dataset PNG. RGB holiday photos are not SAR.";
const EMPTY_SAR =
  "SAR file is empty. Use a Sentinel-1 GRD / dataset PNG; RGB holiday photos are not SAR.";
const RGB_REJECT =
  "RGB holiday photos are not SAR. Use a Sentinel-1 GRD / dataset PNG (VV/VH), not a JPEG.";
const PHASE_B = "backend Phase B endpoint";
const FORM_FIELDS = [
  "wind_speed",
  "wind_toward",
  "current_speed",
  "current_toward",
  "observed_at",
  "south",
  "west",
  "north",
  "east",
];

function looksLikeRgbPhoto(file) {
  if (!file) return false;
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();
  return (
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".webp") ||
    type === "image/jpeg" ||
    type === "image/webp"
  );
}

function unwrapCase(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.slick || payload.vessels || payload.sar || payload.drift) return payload;
  if (payload.case && typeof payload.case === "object") return payload.case;
  if (payload.data && typeof payload.data === "object") return payload.data;
  return payload;
}

function looksLikeCase(data) {
  if (!data || typeof data !== "object") return false;
  return Boolean(data.slick || data.vessels || data.sar || data.drift || data.id);
}

function detailFromBody(text) {
  if (!text) return "";
  try {
    const json = JSON.parse(text);
    if (typeof json.detail === "string") return json.detail;
    if (Array.isArray(json.detail)) {
      return json.detail
        .map((item) => (typeof item === "string" ? item : item.msg || JSON.stringify(item)))
        .join("; ");
    }
    if (json.message) return String(json.message);
    if (json.error) return String(json.error);
  } catch {
    return text.replace(/\s+/g, " ").trim().slice(0, 280);
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 280);
}

function formatHttpError(status, detail) {
  const body = detail ? ` ${detail}` : "";
  if (status === 404 || status === 405 || status === 501 || status === 502 || status === 503) {
    return `HTTP ${status} — ${PHASE_B}.${body}`;
  }
  return `HTTP ${status}.${body}`.trim();
}

export function buildInvestigateFormData(form) {
  const fd = new FormData();
  const sar = form.elements.sar?.files?.[0];
  if (sar) fd.append("sar", sar, sar.name);
  const ais = form.elements.ais?.files?.[0];
  if (ais && ais.size > 0) fd.append("ais", ais, ais.name);
  for (const name of FORM_FIELDS) {
    const el = form.elements[name];
    if (!el) continue;
    const value = String(el.value ?? "").trim();
    if (value !== "") fd.append(name, value);
  }
  return fd;
}

function validateSar(file) {
  if (!file || file.size === 0) return EMPTY_SAR;
  if (looksLikeRgbPhoto(file)) return RGB_REJECT;
  return null;
}

export function bindUpload(form, { setCase } = {}) {
  if (!form) return;

  const sarInput = form.elements.sar;
  const submit = form.querySelector('[type="submit"]');
  const statusEl = form.querySelector("#upload-status") || form.querySelector("[data-upload-status]");

  function showStatus(kind, text) {
    if (!statusEl) return;
    statusEl.hidden = !text;
    statusEl.textContent = text || "";
    statusEl.className = kind === "error" ? "error-copy" : "placeholder-note";
    statusEl.setAttribute("role", kind === "error" ? "alert" : "status");
  }

  function setBusy(busy) {
    form.setAttribute("aria-busy", busy ? "true" : "false");
    form.querySelectorAll("input, button").forEach((el) => {
      el.disabled = busy;
    });
    if (submit) {
      submit.textContent = busy ? BUSY_LABEL : IDLE_LABEL;
    }
  }

  function syncSubmit() {
    if (!submit || form.getAttribute("aria-busy") === "true") return;
    const file = sarInput?.files?.[0];
    submit.disabled = !file;
    submit.title = file ? "" : "Choose a Sentinel-1 GRD / dataset PNG first";
  }

  sarInput?.addEventListener("change", () => {
    const err = validateSar(sarInput.files?.[0]);
    if (err && sarInput.files?.[0]) {
      showStatus("error", err);
      if (sarInput.files[0].size === 0 || looksLikeRgbPhoto(sarInput.files[0])) {
        sarInput.value = "";
      }
    } else {
      showStatus(null, "");
    }
    syncSubmit();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.getAttribute("aria-busy") === "true") return;

    const sar = sarInput?.files?.[0];
    const err = validateSar(sar);
    if (err) {
      showStatus("error", err);
      syncSubmit();
      return;
    }

    const body = buildInvestigateFormData(form);
    setBusy(true);
    showStatus("loading", BUSY_LABEL);
    try {
      const res = await fetch(INVESTIGATE_URL, {
        method: "POST",
        body,
      });
      const raw = await res.text();
      if (!res.ok) {
        throw new Error(formatHttpError(res.status, detailFromBody(raw)));
      }
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new Error(`HTTP ${res.status} — ${PHASE_B} returned non-JSON.`);
      }
      const data = unwrapCase(payload);
      if (!looksLikeCase(data)) {
        throw new Error(`${PHASE_B} returned no case JSON.`);
      }
      if (typeof setCase === "function") setCase(data);
      showStatus("ok", "Case loaded on Map.");
    } catch (error) {
      const network = error instanceof TypeError;
      const message = network
        ? `Cannot reach ${PHASE_B} (/api/investigate). Start backend on port 8000.`
        : error?.message || `${PHASE_B} failed.`;
      showStatus("error", message);
    } finally {
      setBusy(false);
      syncSubmit();
    }
  });

  showStatus(null, "");
  syncSubmit();
}

export { SAR_COPY, FORM_FIELDS };
