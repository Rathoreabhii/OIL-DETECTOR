/** Shared hours from SAR observation. t<0 hindcast, t=0 observation, t>0 forecast. */

let tHours = 0;
const listeners = new Set();

export function getTHours() {
  return tHours;
}

export function setTHours(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return tHours;
  const next = Math.round(n * 10) / 10;
  if (next === tHours) return tHours;
  tHours = next;
  listeners.forEach((fn) => {
    try {
      fn(tHours);
    } catch {
      /* ignore */
    }
  });
  return tHours;
}

export function onTHours(fn) {
  if (typeof fn !== "function") return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function timeRange(caseData) {
  const age = Number(caseData?.slick?.age_hours_est);
  const min = Number.isFinite(age) ? -Math.abs(age) : -16;
  const fore = Array.isArray(caseData?.drift?.forecast) ? caseData.drift.forecast : [];
  let max = 16;
  if (fore.length) {
    const last = Number(fore[fore.length - 1]?.t_hours);
    if (Number.isFinite(last) && last > 0) max = last;
  }
  return { min, max };
}

export function formatTHours(t) {
  const n = Number(t);
  if (!Number.isFinite(n)) return "t = 0.0 h";
  const sign = n > 0 ? "+" : "";
  return `t = ${sign}${n.toFixed(1)} h`;
}
