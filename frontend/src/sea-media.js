/**
 * Decorative Sea-tab water only. Not SAR.
 * Oil is not detected in this footage. Detection stays on SAR / demo JSON.
 */

export const VIDEO_URL = "/sea.mp4";

export function videoHasFrame(el) {
  return Boolean(el && el.videoWidth > 0 && el.videoHeight > 0);
}

export function bindVideo(el) {
  if (!el) return el;
  el.muted = true;
  el.defaultMuted = true;
  el.volume = 0;
  el.loop = true;
  el.playsInline = true;
  el.preload = "auto";
  el.setAttribute("muted", "");
  el.setAttribute("playsinline", "");
  el.setAttribute("autoplay", "");
  if (!el.getAttribute("src") && !el.currentSrc) {
    el.src = VIDEO_URL;
  }
  return el;
}

export function playVideo(el) {
  if (!el || typeof el.play !== "function") return;
  el.muted = true;
  el.defaultMuted = true;
  el.volume = 0;
  try {
    const played = el.play();
    if (played && typeof played.catch === "function") played.catch(() => {});
  } catch {
    /* autoplay rejection — Sea tab click retries */
  }
}

export function pauseVideo(el) {
  if (!el || typeof el.pause !== "function") return;
  try {
    el.pause();
  } catch {
    /* ignore */
  }
}

export function watchVideo(el, { onReady, onError } = {}) {
  if (!el) {
    onError?.();
    return () => {};
  }
  bindVideo(el);
  let readySent = false;
  const ready = () => {
    if (readySent || !videoHasFrame(el)) return;
    readySent = true;
    onReady?.();
  };
  const fail = () => {
    if (readySent) return;
    onError?.();
  };
  el.addEventListener("loadedmetadata", ready);
  el.addEventListener("loadeddata", ready);
  el.addEventListener("canplay", ready);
  el.addEventListener("canplaythrough", ready);
  el.addEventListener("playing", ready);
  el.addEventListener("error", fail);
  if (videoHasFrame(el)) ready();
  return () => {
    el.removeEventListener("loadedmetadata", ready);
    el.removeEventListener("loadeddata", ready);
    el.removeEventListener("canplay", ready);
    el.removeEventListener("canplaythrough", ready);
    el.removeEventListener("playing", ready);
    el.removeEventListener("error", fail);
  };
}
