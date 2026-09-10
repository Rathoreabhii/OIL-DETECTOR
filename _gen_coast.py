"""Mumbai-like peninsula: coastline + zones in Three.js meters."""
import math

def catmull(points, closed=True, step=180.0, min_keep=90.0):
    pts = [tuple(map(float, p)) for p in points]
    if closed:
        if pts[0] == pts[-1]:
            pts = pts[:-1]
        ext = [pts[-2], pts[-1]] + pts + [pts[0], pts[1]]
        nseg = len(pts)
    else:
        ext = [pts[0]] + pts + [pts[-1]]
        nseg = len(pts) - 1

    def tj(ti, a, b, alpha=0.5):
        dx, dz = b[0] - a[0], b[1] - a[1]
        return ti + (dx * dx + dz * dz) ** (alpha * 0.5)

    def lerp_t(pa, pb, ta, tb, t):
        if abs(tb - ta) < 1e-9:
            return pa
        u = (t - ta) / (tb - ta)
        return (pa[0] + u * (pb[0] - pa[0]), pa[1] + u * (pb[1] - pa[1]))

    out = []
    for i in range(nseg):
        p0, p1, p2, p3 = ext[i], ext[i + 1], ext[i + 2], ext[i + 3]
        t0 = 0.0
        t1 = tj(t0, p0, p1)
        t2 = tj(t1, p1, p2)
        t3 = tj(t2, p2, p3)
        seg_len = max(1e-6, math.hypot(p2[0] - p1[0], p2[1] - p1[1]))
        n = max(1, int(round(seg_len / step)))
        for k in range(n):
            t = t1 + (t2 - t1) * (k / n)
            a1 = lerp_t(p0, p1, t0, t1, t)
            a2 = lerp_t(p1, p2, t1, t2, t)
            a3 = lerp_t(p2, p3, t2, t3, t)
            b1 = lerp_t(a1, a2, t0, t2, t)
            b2 = lerp_t(a2, a3, t1, t3, t)
            c = lerp_t(b1, b2, t1, t2, t)
            out.append((round(c[0], 1), round(c[1], 1)))

    cleaned = [out[0]]
    for p in out[1:]:
        if math.hypot(p[0] - cleaned[-1][0], p[1] - cleaned[-1][1]) >= min_keep:
            cleaned.append(p)
    if closed:
        d0 = math.hypot(cleaned[-1][0] - cleaned[0][0], cleaned[-1][1] - cleaned[0][1])
        if d0 < min_keep * 0.6:
            cleaned[-1] = cleaned[0]
        elif cleaned[0] != cleaned[-1]:
            cleaned.append(cleaned[0])
    return cleaned


def poly_area(pts):
    ring = pts[:-1] if pts[0] == pts[-1] else pts
    a = 0.0
    n = len(ring)
    for i in range(n):
        x1, z1 = ring[i]
        x2, z2 = ring[(i + 1) % n]
        a += x1 * z2 - x2 * z1
    return 0.5 * a


def perimeter(pts):
    ring = pts if pts[0] == pts[-1] else pts + [pts[0]]
    return sum(
        math.hypot(ring[i + 1][0] - ring[i][0], ring[i + 1][1] - ring[i][1])
        for i in range(len(ring) - 1)
    )


def width_at_z(pts, z_query):
    ring = pts[:-1] if pts[0] == pts[-1] else pts
    xs = []
    n = len(ring)
    for i in range(n):
        x1, z1 = ring[i]
        x2, z2 = ring[(i + 1) % n]
        if (z1 <= z_query <= z2) or (z2 <= z_query <= z1):
            if abs(z2 - z1) < 1e-9:
                continue
            t = (z_query - z1) / (z2 - z1)
            xs.append(x1 + t * (x2 - x1))
    if len(xs) < 2:
        return None
    return round(min(xs), 1), round(max(xs), 1), round(max(xs) - min(xs), 1)


def densify(ctrl, step, keep, closed=True):
    return catmull(ctrl, closed=closed, step=step, min_keep=keep)


def resample_n(pts, n, closed=True):
    """Arc-length resample. Closed rings return n unique verts plus a closing copy."""
    ring = list(pts)
    if closed and ring[0] == ring[-1]:
        ring = ring[:-1]
    dists = []
    total = 0.0
    count = len(ring) if closed else len(ring) - 1
    for i in range(count):
        a = ring[i]
        b = ring[(i + 1) % len(ring)] if closed else ring[i + 1]
        d = math.hypot(b[0] - a[0], b[1] - a[1])
        dists.append(d)
        total += d
    if total < 1e-6:
        return pts
    out = []
    samples = n
    for k in range(samples):
        t = (k / samples) * total if closed else (k / (samples - 1)) * total
        acc = 0.0
        chosen = ring[0]
        for i in range(count):
            d = dists[i]
            if acc + d >= t or i == count - 1:
                a = ring[i]
                b = ring[(i + 1) % len(ring)] if closed else ring[i + 1]
                u = 0.0 if d < 1e-9 else (t - acc) / d
                u = max(0.0, min(1.0, u))
                chosen = (round(a[0] + u * (b[0] - a[0])), round(a[1] + u * (b[1] - a[1])))
                break
            acc += d
        if not out or chosen != out[-1]:
            out.append(chosen)
    if closed and out[0] != out[-1]:
        out.append(out[0])
    return out


def fmt_poly(pts):
    lines = ["["]
    for x, z in pts:
        lines.append(f"  [{x:.1f}, {z:.1f}],")
    lines.append("]")
    return "\n".join(lines)


# Closed land polygon. Walk: tip -> east harbour north (-Z) -> north edge west
# -> west coast south (Back Bay C) -> tip.
# Origin = Colaba Point. +X east, +Z south.
COAST_CTRL = [
    # Colaba Point — southern rock tip (origin)
    [0.0, 0.0],
    [220.0, 28.0],
    [390.0, -90.0],
    [470.0, -360.0],
    [515.0, -720.0],
    [545.0, -1120.0],
    [570.0, -1540.0],
    [600.0, -1980.0],
    # Sassoon Dock analog
    [780.0, -2280.0],
    [960.0, -2380.0],
    [930.0, -2520.0],
    [720.0, -2680.0],
    [590.0, -2940.0],
    [575.0, -3280.0],
    # Apollo Bunder / Gateway bulge
    [640.0, -3600.0],
    [820.0, -3880.0],
    [980.0, -4080.0],
    [1060.0, -4260.0],
    [1020.0, -4460.0],
    [1100.0, -4680.0],
    [1180.0, -4920.0],
    # Fort / Ballard stay east so the Back Bay waist is ~1.1–1.3 km
    [1280.0, -5280.0],
    [1380.0, -5640.0],
    [1480.0, -6020.0],
    [1480.0, -6420.0],
    [1620.0, -6860.0],
    [1580.0, -7220.0],
    [1740.0, -7680.0],
    [1680.0, -8120.0],
    [1840.0, -8600.0],
    [1780.0, -9120.0],
    [1920.0, -9680.0],
    [1860.0, -10280.0],
    [2000.0, -10920.0],
    [1940.0, -11600.0],
    [2060.0, -12320.0],
    [2000.0, -13040.0],
    [2100.0, -13800.0],
    [2040.0, -14560.0],
    [2080.0, -15320.0],
    [1980.0, -16040.0],
    [1840.0, -16720.0],
    [1660.0, -17320.0],
    [1420.0, -17800.0],
    # NE corner — Mahim / Sion analog
    [1080.0, -18160.0],
    [620.0, -18380.0],
    [140.0, -18480.0],
    [-420.0, -18460.0],
    [-1020.0, -18340.0],
    [-1640.0, -18140.0],
    [-2220.0, -18100.0],
    # Bandra Land's End / fort rock
    [-2680.0, -18040.0],
    [-2960.0, -17880.0],
    [-2880.0, -17660.0],  # Bandra Fort
    [-2580.0, -17480.0],  # sea-link north abutment
    # Mahim Bay (open west, ~5.4 km mouth)
    [-1920.0, -17440.0],
    [-1220.0, -17160.0],
    [-640.0, -16800.0],
    [-260.0, -16340.0],
    [-100.0, -15780.0],
    [-160.0, -15160.0],
    [-460.0, -14600.0],
    [-980.0, -14080.0],
    [-1560.0, -13620.0],
    [-2140.0, -13180.0],
    [-2580.0, -12140.0],  # Worli Point / sea-link south
    [-2740.0, -11820.0],  # Worli Fort
    [-2360.0, -11440.0],
    [-1920.0, -11020.0],
    [-1680.0, -10560.0],
    [-1580.0, -10080.0],
    [-1600.0, -9600.0],
    # Haji Ali bay
    [-1480.0, -9180.0],
    [-1120.0, -9280.0],
    [-980.0, -8820.0],
    [-1280.0, -8360.0],
    # Malabar Hill
    [-1780.0, -7940.0],
    [-2360.0, -7580.0],
    [-2940.0, -7280.0],
    [-3480.0, -7040.0],  # Malabar Point
    [-3280.0, -6780.0],
    [-2720.0, -6600.0],
    [-2080.0, -6480.0],
    [-1440.0, -6420.0],  # Chowpatty
    [-860.0, -6320.0],
    [-380.0, -6120.0],
    # Marine Drive C (bay open west; apex is the east-most west-coast)
    [-80.0, -5820.0],
    [20.0, -5440.0],
    [70.0, -5040.0],
    [40.0, -4640.0],
    [-60.0, -4260.0],
    [-220.0, -3940.0],
    # Nariman Point
    [-460.0, -3700.0],
    [-780.0, -3520.0],
    [-980.0, -3360.0],
    [-900.0, -3140.0],
    # Cuffe Parade west
    [-740.0, -2860.0],
    [-660.0, -2500.0],
    (-640.0, -2100.0),
    [-660.0, -1680.0],
    [-690.0, -1240.0],
    [-720.0, -820.0],
    [-730.0, -420.0],
    [-640.0, -140.0],
    [-420.0, -20.0],
    [-200.0, 8.0],
]

coast = densify(COAST_CTRL, step=160, keep=70)
coast = resample_n(coast, 124, closed=True)
# Force origin as first vertex
if coast[0] != (0.0, 0.0):
    d = [math.hypot(p[0], p[1]) for p in coast[:-1]]
    i0 = min(range(len(d)), key=lambda i: d[i])
    body = coast[:-1]
    body = body[i0:] + body[:i0]
    body[0] = (0.0, 0.0)
    coast = body + [body[0]]

print("POINTS", len(coast), "closed", coast[0] == coast[-1], "start", coast[0])
print("BBOX x", min(p[0] for p in coast), max(p[0] for p in coast),
      "z", min(p[1] for p in coast), max(p[1] for p in coast))
print("NS_km", (max(p[1] for p in coast) - min(p[1] for p in coast)) / 1000)
print("EW_km", (max(p[0] for p in coast) - min(p[0] for p in coast)) / 1000)
print("AREA_km2", round(abs(poly_area(coast)) / 1e6, 2), "sign", poly_area(coast))
print("PERI_km", round(perimeter(coast) / 1000, 2))
for zq in [0, -500, -1500, -2800, -3360, -4260, -5040, -6400, -7040, -9800, -11400, -13040, -15460, -17320, -18400]:
    print(f"W z={zq:7d}", width_at_z(coast, zq))

# ASCII north-up
def ascii_map(pts, w=72, h=42):
    xs = [p[0] for p in pts]; zs = [p[1] for p in pts]
    xmin, xmax = min(xs) - 400, max(xs) + 2200  # extra east ocean
    zmin, zmax = min(zs) - 200, max(zs) + 800
    grid = [["." for _ in range(w)] for _ in range(h)]

    def sx(x):
        return int((x - xmin) / (xmax - xmin) * (w - 1))

    def sy(z):
        # north up: smaller z (more north) at top
        return int((z - zmax) / (zmin - zmax) * (h - 1))

    ring = pts[:-1]
    # fill
    for j in range(h):
        z = zmax + (zmin - zmax) * (j / (h - 1))
        crossings = []
        n = len(ring)
        for i in range(n):
            x1, z1 = ring[i]
            x2, z2 = ring[(i + 1) % n]
            if (z1 <= z < z2) or (z2 <= z < z1):
                if abs(z2 - z1) < 1e-9:
                    continue
                t = (z - z1) / (z2 - z1)
                crossings.append(x1 + t * (x2 - x1))
        crossings.sort()
        for a, b in zip(crossings[0::2], crossings[1::2]):
            ia, ib = sx(a), sx(b)
            for x in range(max(0, ia), min(w, ib + 1)):
                grid[j][x] = "#"
    # landmarks
    marks = {
        "G": (1060, -4260),
        "N": (-980, -3360),
        "M": (-3480, -7040),
        "W": (-2580, -13040),
        "B": (-2820, -17320),
        "F": (3200, -3900),
    }
    for ch, (x, z) in marks.items():
        i, j = sx(x), sy(z)
        if 0 <= i < w and 0 <= j < h:
            grid[j][i] = ch
    return "\n".join("".join(row) for row in grid)


print("\nMAP (north up, #=land, .=ocean, G gateway N nariman M malabar W worli B bandra F fort-island)\n")
print(ascii_map(coast))

# ---------------- zones ----------------
# Keep rings simple and inside land. Winding same as coast.

BEACH_BACKBAY = densify([
    [-980.0, -3360.0],
    [-780.0, -3520.0],
    [-460.0, -3700.0],
    [-220.0, -3940.0],
    [-60.0, -4260.0],
    [40.0, -4640.0],
    [70.0, -5040.0],
    [20.0, -5440.0],
    [-80.0, -5820.0],
    [-380.0, -6120.0],
    [-860.0, -6320.0],
    [-1440.0, -6420.0],
    [-2080.0, -6480.0],
    [-2080.0, -6385.0],
    [-1440.0, -6325.0],
    [-860.0, -6225.0],
    [-400.0, -6025.0],
    [-140.0, -5740.0],
    [-45.0, -5400.0],
    [5.0, -5040.0],
    [-20.0, -4660.0],
    [-120.0, -4300.0],
    [-280.0, -4000.0],
    [-520.0, -3780.0],
    [-800.0, -3600.0],
    [-960.0, -3440.0],
], 80, 45)

BEACH_WORLI = densify([
    [-2580.0, -12140.0],
    [-2360.0, -11440.0],
    [-1920.0, -11020.0],
    [-1680.0, -10560.0],
    [-1580.0, -10080.0],
    [-1600.0, -9600.0],
    [-1480.0, -9180.0],
    [-1400.0, -9200.0],
    [-1520.0, -9620.0],
    [-1505.0, -10080.0],
    [-1605.0, -10560.0],
    [-1845.0, -11000.0],
    [-2280.0, -11410.0],
    [-2500.0, -12070.0],
], 80, 40)

BEACH_CHOWPATTY_POCKET = densify([
    [-1440.0, -6420.0],
    [-860.0, -6320.0],
    [-860.0, -6180.0],
    [-1440.0, -6280.0],
], 70, 40)

PARK_MAIDANS = densify([
    [40.0, -4480.0],
    [280.0, -4580.0],
    [420.0, -4980.0],
    [440.0, -5420.0],
    [360.0, -5860.0],
    [180.0, -6180.0],
    [-20.0, -6360.0],
    [-120.0, -6280.0],
    [40.0, -6060.0],
    [220.0, -5760.0],
    [300.0, -5400.0],
    [280.0, -5000.0],
    [160.0, -4660.0],
], 70, 40)

PARK_MALABAR = densify([
    [-3280.0, -6780.0],
    [-2720.0, -6600.0],
    [-2080.0, -6480.0],
    [-1780.0, -6620.0],
    [-1680.0, -6980.0],
    [-1860.0, -7380.0],
    [-2280.0, -7620.0],
    [-2780.0, -7380.0],
    [-3180.0, -7080.0],
], 80, 45)

PARK_RACECOURSE = densify([
    [-1120.0, -9280.0],
    [-1280.0, -8360.0],
    [-860.0, -8120.0],
    [-380.0, -8280.0],
    [-220.0, -8860.0],
    [-400.0, -9380.0],
    [-820.0, -9460.0],
], 80, 45)

PARK_OVAL_SOUTH = densify([
    [-40.0, -3920.0],
    [180.0, -4080.0],
    [260.0, -4380.0],
    [80.0, -4480.0],
    [-120.0, -4280.0],
    [-160.0, -4040.0],
], 60, 35)

CBD_NARIMAN = densify([
    [-900.0, -3140.0],
    [-740.0, -2860.0],
    [-520.0, -2740.0],
    [-160.0, -2860.0],
    [120.0, -3180.0],
    [320.0, -3600.0],
    [480.0, -4080.0],
    [520.0, -4480.0],
    [280.0, -4580.0],
    [40.0, -4480.0],
    [-160.0, -4040.0],
    [-40.0, -3920.0],
    [-160.0, -3940.0],
    [-460.0, -3700.0],
    [-780.0, -3520.0],
    [-980.0, -3360.0],
], 70, 40)

CBD_CUFFE = densify([
    [-720.0, -820.0],
    [-730.0, -420.0],
    [-640.0, -140.0],
    [-280.0, -180.0],
    [-40.0, -520.0],
    [80.0, -1020.0],
    [140.0, -1580.0],
    [160.0, -2100.0],
    [80.0, -2520.0],
    [-160.0, -2860.0],
    [-520.0, -2740.0],
    [-660.0, -2500.0],
    [-640.0, -2100.0],
    [-660.0, -1680.0],
    [-690.0, -1240.0],
], 80, 45)

CBD_WORLI = densify([
    [-1920.0, -11020.0],
    [-1280.0, -10940.0],
    [-720.0, -11120.0],
    [-320.0, -11580.0],
    [-240.0, -12140.0],
    [-480.0, -12540.0],
    [-1100.0, -12440.0],
    [-1680.0, -12200.0],
    [-2140.0, -11900.0],
    [-2360.0, -11440.0],
], 80, 45)

DOCKS = densify([
    [860.0, -4680.0],
    [1020.0, -4460.0],
    [1060.0, -4260.0],
    [1220.0, -4380.0],
    [1380.0, -4860.0],
    [1480.0, -5460.0],
    [1340.0, -6020.0],
    [1480.0, -6420.0],
    [1620.0, -6860.0],
    [1740.0, -7680.0],
    [1840.0, -8600.0],
    [1920.0, -9680.0],
    [2000.0, -10920.0],
    [2060.0, -12320.0],
    [2100.0, -13800.0],
    [2080.0, -15320.0],
    [1840.0, -16720.0],
    [1420.0, -17800.0],
    [1080.0, -18160.0],
    [820.0, -18040.0],
    [700.0, -17200.0],
    [760.0, -15600.0],
    [840.0, -13600.0],
    [900.0, -11400.0],
    [880.0, -9200.0],
    [800.0, -7200.0],
    [740.0, -5800.0],
    [780.0, -5100.0],
], 160, 80)

LOWRISE_COLABA = densify([
    [-640.0, -140.0],
    [-420.0, -20.0],
    [-200.0, 8.0],
    [0.0, 0.0],
    [220.0, 28.0],
    [390.0, -90.0],
    [515.0, -720.0],
    [570.0, -1540.0],
    [600.0, -1980.0],
    [590.0, -2940.0],
    [575.0, -3280.0],
    [320.0, -3180.0],
    [40.0, -2720.0],
    [-160.0, -2100.0],
    [-280.0, -1400.0],
    [-400.0, -720.0],
], 90, 50)

LOWRISE_INNER = densify([
    [-220.0, -8860.0],
    [80.0, -8600.0],
    [420.0, -8200.0],
    [620.0, -7400.0],
    [700.0, -6400.0],
    [740.0, -5800.0],
    [800.0, -7200.0],
    [880.0, -9200.0],
    [840.0, -11000.0],
    [760.0, -12800.0],
    [200.0, -13200.0],
    [-240.0, -13040.0],
    [-320.0, -12480.0],
    [-200.0, -11200.0],
    [-280.0, -9800.0],
    [-400.0, -9380.0],
], 120, 70)

LOWRISE_MAHIM = densify([
    [-120.0, -15460.0],
    [-180.0, -14920.0],
    [-480.0, -14440.0],
    [-200.0, -14200.0],
    [200.0, -14600.0],
    [400.0, -15400.0],
    [360.0, -16400.0],
    [-260.0, -15940.0],
], 100, 55)

MIDRISE_CENTRAL = densify([
    [-1280.0, -8360.0],
    [-1780.0, -7940.0],
    [-1680.0, -6980.0],
    [-1780.0, -6620.0],
    [-2080.0, -6480.0],
    [-1440.0, -6420.0],
    [-860.0, -6320.0],
    [-380.0, -6120.0],
    [-120.0, -6280.0],
    [-20.0, -6360.0],
    [180.0, -6180.0],
    [360.0, -5860.0],
    [440.0, -5420.0],
    [520.0, -4480.0],
    [480.0, -4080.0],
    [820.0, -4920.0],
    [980.0, -5280.0],
    [1180.0, -5640.0],
    [740.0, -5800.0],
    [700.0, -6400.0],
    [620.0, -7400.0],
    [420.0, -8200.0],
    [80.0, -8600.0],
    [-220.0, -8860.0],
    [-400.0, -9380.0],
    [-820.0, -9460.0],
    [-1120.0, -9280.0],
], 110, 60)

ZONE_N = {
    "BEACH_BACKBAY": 28,
    "BEACH_WORLI": 20,
    "BEACH_CHOWPATTY_POCKET": 10,
    "PARK_MAIDANS": 16,
    "PARK_MALABAR": 14,
    "PARK_RACECOURSE": 12,
    "PARK_OVAL_SOUTH": 10,
    "CBD_NARIMAN": 22,
    "CBD_CUFFE": 20,
    "CBD_WORLI": 16,
    "DOCKS": 28,
    "LOWRISE_COLABA": 22,
    "LOWRISE_INNER": 22,
    "LOWRISE_MAHIM": 14,
    "MIDRISE_CENTRAL": 26,
}

raw_zones = {
    "BEACH_BACKBAY": BEACH_BACKBAY,
    "BEACH_WORLI": BEACH_WORLI,
    "BEACH_CHOWPATTY_POCKET": BEACH_CHOWPATTY_POCKET,
    "PARK_MAIDANS": PARK_MAIDANS,
    "PARK_MALABAR": PARK_MALABAR,
    "PARK_RACECOURSE": PARK_RACECOURSE,
    "PARK_OVAL_SOUTH": PARK_OVAL_SOUTH,
    "CBD_NARIMAN": CBD_NARIMAN,
    "CBD_CUFFE": CBD_CUFFE,
    "CBD_WORLI": CBD_WORLI,
    "DOCKS": DOCKS,
    "LOWRISE_COLABA": LOWRISE_COLABA,
    "LOWRISE_INNER": LOWRISE_INNER,
    "LOWRISE_MAHIM": LOWRISE_MAHIM,
    "MIDRISE_CENTRAL": MIDRISE_CENTRAL,
}

zones = {k: resample_n(v, ZONE_N[k], closed=True) for k, v in raw_zones.items()}

print("\nZONES")
for name, poly in zones.items():
    print(f"{name:24s} n={len(poly):3d} km2={abs(poly_area(poly))/1e6:.3f}")

cam = (4850.0, 1020.0, 2650.0)
tgt = (180.0, 10.0, -6900.0)
zx, zz = cam[0] - tgt[0], cam[2] - tgt[2]
rx, rz = zz, -zx
rn = math.hypot(rx, rz)
rx, rz = rx / rn, rz / rn
print("\nCAM right xz", round(rx, 3), round(rz, 3), "=> right is east" if rx > 0 else "RIGHT NOT EAST")
print("view yaw west-of-north deg", round(math.degrees(math.atan2(-(tgt[0] - cam[0]), -(tgt[2] - cam[2]))), 2))
print("sea-link mouth m", abs(-17480 - -12140))


def js_ring(pts, indent=2):
    pad = " " * indent
    inner = ",\n".join(f"{pad}[{int(x)}, {int(z)}]" for x, z in pts)
    return "[\n" + inner + ",\n" + " " * (indent - 2) + "]" if indent > 2 else "[\n" + inner + "\n]"


grouped = {
    "beach": ["BEACH_BACKBAY", "BEACH_WORLI", "BEACH_CHOWPATTY_POCKET"],
    "park": ["PARK_MAIDANS", "PARK_OVAL_SOUTH", "PARK_MALABAR", "PARK_RACECOURSE"],
    "cbd": ["CBD_NARIMAN", "CBD_CUFFE", "CBD_WORLI"],
    "midrise": ["MIDRISE_CENTRAL"],
    "lowrise": ["LOWRISE_COLABA", "LOWRISE_INNER", "LOWRISE_MAHIM"],
    "harbourDocks": ["DOCKS"],
}

js = []
js.append("// Closed land polygon. [x, z] meters. Origin = Colaba Point.")
js.append("// +X east, +Z south, -Z north. Land west / interior; ocean east and south.")
js.append("// Walk: tip -> east harbour north -> north edge west -> west coast south (Back Bay) -> tip.")
js.append(f"export const COASTLINE = {js_ring(coast)};")
js.append("")
js.append("export const ZONES = {")
for gname, keys in grouped.items():
    js.append(f"  {gname}: [")
    for k in keys:
        js.append(f"    {js_ring(zones[k], 6)},")
    js.append("  ],")
js.append("};")

path = r"E:\oil detector\_layout_out.js"
with open(path, "w", encoding="utf-8") as f:
    f.write("\n".join(js))
    f.write("\n")
print("wrote", path, "coast n", len(coast))
