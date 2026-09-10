import L from "leaflet";
import { vesselKey, vesselName } from "./panel.js";
import { shiftPolygon, vesselAtTime } from "./leeway.js";

const RANK_COLORS = ["#d7b06a", "#c4a06a", "#9a8d74", "#7d8694", "#6a7380", "#585f6c"];
const ARABIAN = [18.65, 71.95];

function rankColor(rank) {
  const i = Math.max(1, Number(rank) || 1) - 1;
  return RANK_COLORS[Math.min(i, RANK_COLORS.length - 1)];
}

function toBounds(raw) {
  if (!raw) return null;
  try {
    if (Array.isArray(raw) && raw.length >= 2) {
      return L.latLngBounds(raw[0], raw[1]);
    }
    if (raw.south != null && raw.west != null && raw.north != null && raw.east != null) {
      return L.latLngBounds([raw.south, raw.west], [raw.north, raw.east]);
    }
  } catch {
    return null;
  }
  return null;
}

function trackPoints(vessel) {
  const track = Array.isArray(vessel?.track) ? vessel.track : [];
  return track
    .filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)))
    .slice()
    .sort((a, b) => String(a.t ?? "").localeCompare(String(b.t ?? "")));
}

function latestFix(vessel) {
  const pts = trackPoints(vessel);
  return pts.length ? pts[pts.length - 1] : null;
}

function driftLine(points) {
  if (!Array.isArray(points)) return [];
  return points
    .filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)))
    .slice()
    .sort((a, b) => Number(a.t_hours ?? 0) - Number(b.t_hours ?? 0))
    .map((p) => [Number(p.lat), Number(p.lon)]);
}

function resolveUrl(url) {
  if (!url || typeof url !== "string") return null;
  return url;
}

export function createMap(el, { onSelect }) {
  const map = L.map(el, {
    zoomControl: true,
    attributionControl: true,
    minZoom: 3,
  });

  map.createPane("sarPane");
  map.getPane("sarPane").style.zIndex = 350;

  const esri = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Tiles © Esri",
      maxZoom: 19,
    },
  );
  const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
    maxZoom: 19,
  });

  let usedFallback = false;
  esri.on("tileerror", () => {
    if (usedFallback) return;
    usedFallback = true;
    if (map.hasLayer(esri)) map.removeLayer(esri);
    if (!map.hasLayer(osm)) osm.addTo(map);
  });
  esri.addTo(map);

  const layers = {
    sar: L.layerGroup().addTo(map),
    slick: L.layerGroup().addTo(map),
    origin: L.layerGroup().addTo(map),
    vessels: L.layerGroup().addTo(map),
  };

  L.control
    .layers(
      { Imagery: esri, Streets: osm },
      { SAR: layers.sar, Slick: layers.slick, Origin: layers.origin, Vessels: layers.vessels },
      { position: "topright", collapsed: true },
    )
    .addTo(map);

  const legend = L.control({ position: "bottomleft" });
  legend.onAdd = () => {
    const div = L.DomUtil.create("div", "map-legend");
    div.setAttribute("aria-label", "Map legend");
    div.innerHTML = `
      <div><i class="swatch slick" aria-hidden="true"></i> Slick</div>
      <div><i class="swatch hindcast" aria-hidden="true"></i> Hindcast</div>
      <div><i class="swatch forecast" aria-hidden="true"></i> Forecast</div>
      <div><span class="legend-ship" aria-hidden="true">1</span> Rank-1 ship</div>
    `;
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  legend.addTo(map);

  map.setView(ARABIAN, 9);

  const ro = new ResizeObserver(() => {
    map.invalidateSize({ animate: false });
  });
  ro.observe(el);
  requestAnimationFrame(() => map.invalidateSize({ animate: false }));

  let gen = 0;
  let selectedKey = null;
  let caseData = null;
  let tHours = 0;
  const markers = new Map();
  let slickPoly = null;

  map.on("click", () => {
    if (typeof onSelect === "function") onSelect(null);
  });

  function clearLayers() {
    Object.values(layers).forEach((g) => g.clearLayers());
    markers.clear();
  }

  function shipIcon(rank, selected) {
    const color = rankColor(rank);
    return L.divIcon({
      className: `ship-icon${selected ? " is-selected" : ""}`,
      html: `<span class="ship-chip" style="--ship:${color}">${Number(rank) || "?"}</span>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  }

  function paintMarkers() {
    const vessels = Array.isArray(caseData?.vessels) ? caseData.vessels : [];
    markers.forEach((marker) => {
      const on = marker._vesselKey === selectedKey;
      marker.setIcon(shipIcon(marker._rank, on));
      marker.setZIndexOffset(on ? 1000 : (8 - (marker._rank || 8)) * 20);
    });
    const stale = [];
    layers.vessels.eachLayer((layer) => {
      if (layer._aisTrack) stale.push(layer);
    });
    stale.forEach((layer) => layers.vessels.removeLayer(layer));
    if (!selectedKey) return;
    const idx = vessels.findIndex((v, i) => vesselKey(v, i) === selectedKey);
    if (idx < 0) return;
    const vessel = vessels[idx];
    const pts = trackPoints(vessel).map((p) => [Number(p.lat), Number(p.lon)]);
    if (pts.length > 1) {
      const trackLine = L.polyline(pts, {
        color: rankColor(vessel.rank ?? idx + 1),
        weight: 2,
        opacity: 0.9,
        dashArray: "5 7",
      });
      trackLine._aisTrack = true;
      trackLine.addTo(layers.vessels);
    }
  }

  function addSar(url, bounds, token) {
    const img = new Image();
    img.onload = () => {
      if (token !== gen) return;
      L.imageOverlay(url, bounds, {
        pane: "sarPane",
        opacity: 1,
        alt: "SAR scene",
        interactive: false,
      }).addTo(layers.sar);
    };
    img.onerror = () => {
      if (token !== gen) return;
    };
    img.src = url;
  }

  function render(data, key) {
    const token = ++gen;
    caseData = data;
    selectedKey = key ?? null;
    clearLayers();

    if (!data) {
      map.setView(ARABIAN, 8);
      return;
    }

    const fit = L.latLngBounds([]);
    const sarBounds = toBounds(data.sar?.bounds);
    const sarUrl = resolveUrl(data.sar?.image_url);
    if (sarBounds && sarBounds.isValid()) {
      fit.extend(sarBounds);
      if (sarUrl) addSar(sarUrl, sarBounds, token);
    }

    slickPoly = null;
    const poly = data.slick?.polygon;
    if (Array.isArray(poly) && poly.length >= 3) {
      const shifted = tHours ? shiftPolygon(poly, data.environment, tHours) : poly;
      const slick = L.polygon(shifted, {
        color: "#c4a36a",
        weight: 2,
        fillColor: "#3a2e1c",
        fillOpacity: 0.45,
        opacity: 0.95,
      }).addTo(layers.slick);
      slickPoly = slick;
      if (slick.getBounds().isValid()) fit.extend(slick.getBounds());
    }

    const hind = driftLine(data.drift?.hindcast);
    const fore = driftLine(data.drift?.forecast);
    if (hind.length) {
      L.polyline(hind, {
        color: "#8a9aab",
        weight: 3,
        opacity: 0.95,
      }).addTo(layers.slick);
      hind.forEach((ll) => fit.extend(ll));
      L.circleMarker(hind[0], {
        radius: 5,
        color: "#d7d2c8",
        weight: 2,
        fillColor: "#8a9aab",
        fillOpacity: 1,
      })
        .bindTooltip("Leeway origin")
        .addTo(layers.origin);
      const nowPt = hind[hind.length - 1];
      L.circleMarker(nowPt, {
        radius: 4,
        color: "#d7d2c8",
        weight: 1,
        fillColor: "#c4a36a",
        fillOpacity: 1,
      })
        .bindTooltip("Observation (t = 0)")
        .addTo(layers.origin);
    }
    if (fore.length) {
      L.polyline(fore, {
        color: "#c4844a",
        weight: 3,
        opacity: 0.95,
        dashArray: "8 6",
      }).addTo(layers.slick);
      fore.forEach((ll) => fit.extend(ll));
    }

    const vessels = Array.isArray(data.vessels) ? data.vessels : [];
    const observed = data.observed_at;
    vessels.forEach((vessel, i) => {
      const at = vesselAtTime(vessel, tHours, observed) || latestFix(vessel);
      if (!at) return;
      const keyId = vesselKey(vessel, i);
      const rank = vessel.rank ?? i + 1;
      const marker = L.marker([Number(at.lat), Number(at.lon)], {
        icon: shipIcon(rank, keyId === selectedKey),
        keyboard: true,
        title: `${rank}. ${vesselName(vessel, i)}`,
        riseOnHover: true,
        zIndexOffset: keyId === selectedKey ? 1000 : (8 - rank) * 20,
      });
      marker._vesselKey = keyId;
      marker._rank = rank;
      marker._vessel = vessel;
      marker.bindTooltip(`${rank} · ${vesselName(vessel, i)}`);
      marker.on("click", (ev) => {
        L.DomEvent.stopPropagation(ev);
        if (typeof onSelect === "function") onSelect(keyId);
      });
      marker.addTo(layers.vessels);
      markers.set(keyId, marker);
      fit.extend([Number(at.lat), Number(at.lon)]);
    });

    paintMarkers();

    requestAnimationFrame(() => {
      if (token !== gen) return;
      map.invalidateSize({ animate: false });
      if (fit.isValid()) map.fitBounds(fit.pad(0.18), { animate: false });
      else map.setView(ARABIAN, 9);
    });
  }

  function setSelected(key) {
    selectedKey = key;
    paintMarkers();
    const marker = key ? markers.get(key) : null;
    if (marker && !map.getBounds().contains(marker.getLatLng())) {
      map.panTo(marker.getLatLng());
    }
  }

  function setTime(hours) {
    tHours = Number(hours) || 0;
    if (!caseData) return;
    const poly = caseData.slick?.polygon;
    if (slickPoly && Array.isArray(poly) && poly.length >= 3) {
      const shifted = shiftPolygon(poly, caseData.environment, tHours);
      if (shifted.length) slickPoly.setLatLngs(shifted);
    }
    const observed = caseData.observed_at;
    markers.forEach((marker) => {
      const at = vesselAtTime(marker._vessel, tHours, observed);
      if (at) marker.setLatLng([at.lat, at.lon]);
    });
  }

  function setLayer(name, on) {
    const group = layers[name];
    if (!group) return;
    if (on) {
      if (!map.hasLayer(group)) group.addTo(map);
    } else if (map.hasLayer(group)) {
      map.removeLayer(group);
    }
  }

  function invalidate() {
    map.invalidateSize({ animate: false });
  }

  return { render, setSelected, invalidate, setTime, setLayer };
}
