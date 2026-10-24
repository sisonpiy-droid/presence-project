// Pure helpers (no DOM) so they can be checked with `node test.mjs`.

export const haversine = (a, b) => {
  const r = Math.PI / 180, R = 6371000;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Offline fallback when the routing server is unreachable: road factor 1.3, 40 km/h.
export const estimate = (a, b) => {
  const m = haversine(a, b) * 1.3;
  return { m, s: m / (40 / 3.6), approx: true };
};

export const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);

export const fmtTime = (s) => {
  const min = Math.round(s / 60);
  if (min < 1) return "<1 min";
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
};

export const fmtAge = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)}s ago` : `${Math.round(ms / 60000)} min ago`);

// Point `d` metres along a polyline of {lat,lng}; clamps to the ends.
export const along = (path, d) => {
  for (let i = 1; i < path.length; i++) {
    const seg = haversine(path[i - 1], path[i]);
    if (d <= seg) {
      const t = seg ? d / seg : 0;
      return { lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * t, lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * t };
    }
    d -= seg;
  }
  return path[path.length - 1];
};

export const pathLength = (path) => path.reduce((n, p, i) => (i ? n + haversine(path[i - 1], p) : 0), 0);

// travelmode=two-wheeler is the Maps URL value for motorbikes.
export const gmapsUrl = (p) =>
  `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=two-wheeler&dir_action=navigate`;

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
export const newCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => ALPHABET[b % ALPHABET.length]).join("");
