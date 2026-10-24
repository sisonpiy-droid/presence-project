import assert from "node:assert/strict";
import { haversine, fmtDist, fmtTime, along, pathLength, gmapsUrl, newCode } from "./geo.js";

const a = { lat: 0, lng: 0 }, b = { lat: 0, lng: 1 };
assert.ok(Math.abs(haversine(a, b) - 111195) < 100);
assert.equal(fmtDist(850), "850 m");
assert.equal(fmtDist(12345), "12 km");
assert.equal(fmtDist(2340), "2.3 km");
assert.equal(fmtTime(20), "<1 min");
assert.equal(fmtTime(1440), "24 min");
assert.equal(fmtTime(3900), "1 h 5 min");

const path = [a, b, { lat: 1, lng: 1 }];
const L = pathLength(path);
assert.deepEqual(along(path, 0), a);
assert.deepEqual(along(path, L + 1e6), path[2]);
const mid = along(path, haversine(a, b) / 2);
assert.ok(Math.abs(mid.lng - 0.5) < 1e-6 && mid.lat === 0);

assert.match(gmapsUrl({ lat: 1, lng: 2 }), /destination=1,2&travelmode=two-wheeler/);
assert.match(newCode(), /^[A-HJKMNP-Z2-9]{5}$/);
console.log("geo ok");
