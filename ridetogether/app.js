import { haversine, estimate, fmtDist, fmtTime, fmtAge, along, pathLength, gmapsUrl, newCode } from "./geo.js";

const OSRM = "https://router.project-osrm.org"; // free public demo server; car profile, fine for bikes
const STALE_MS = 45000;
const GAP_ALERT_M = 3000; // warn when a bike is this far from yours (straight line)
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text || "" });
const tiles = (map) => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
const show = (id) => document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== id));
const home = () => (location.href = location.pathname);
// localStorage can throw (private mode); the app must work without it
const load = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
let toastTimer;
const toast = (msg) => {
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 3500);
};

// ---------- state ----------
// S.pos[bike] = {lat, lng, t}; S.riders = [{id, name, bike}]; S.eta[i] = {dest, [j]} each {m, s, approx?}
const S = { code: "", dest: null, riders: [], pos: {}, me: null, demo: false, eta: {}, key: "", fitted: false };
const ingestRider = (r) => S.riders.some((x) => x.id === r.id) || S.riders.push(r);
const ingestPos = (r) => (S.pos[r.bike] = { lat: r.lat, lng: r.lng, t: Date.parse(r.updated_at) });

// ---------- backends: Supabase (real) and local simulation (demo) ----------
const cfg = window.CONFIG || {};
const sb = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase ? supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
const must = ({ data, error }) => { if (error) throw error; return data; };

const real = {
  async create(d) {
    const code = newCode();
    must(await sb.from("trips").insert({ code, dest_lat: d.lat, dest_lng: d.lng, dest_name: d.name }));
    return code;
  },
  async load(code) {
    const [t, r, p] = await Promise.all([
      sb.from("trips").select().eq("code", code).maybeSingle(),
      sb.from("riders").select().eq("trip", code).order("id"),
      sb.from("positions").select().eq("trip", code),
    ]);
    const trip = must(t);
    if (!trip) return null;
    return { dest: { lat: trip.dest_lat, lng: trip.dest_lng, name: trip.dest_name }, riders: must(r), pos: must(p) };
  },
  async join(code, name, bike) {
    return must(await sb.from("riders").insert({ trip: code, name, bike }).select().single());
  },
  async push(row) {
    must(await sb.from("positions").upsert(row));
  },
  watch(code) {
    const f = { schema: "public", filter: `trip=eq.${code}` };
    sb.channel("trip-" + code)
      .on("postgres_changes", { ...f, event: "*", table: "positions" }, (p) => { ingestPos(p.new); render(); })
      .on("postgres_changes", { ...f, event: "INSERT", table: "riders" }, (p) => { ingestRider(p.new); render(); })
      .subscribe();
    // safety net: phones drop websockets in tunnels / when sleeping
    setInterval(async () => {
      try {
        const d = await real.load(code);
        if (d) { d.riders.forEach(ingestRider); d.pos.forEach(ingestPos); render(); }
      } catch {}
    }, 15000);
  },
};

const DEMO_A = { lat: 12.9756, lng: 77.6068 }; // Bengaluru MG Road
const DEMO_B = { lat: 13.3702, lng: 77.6835, name: "Nandi Hills (demo)" };
const DEMO_SECONDS = 240; // whole route in 4 minutes
async function startDemo() {
  S.demo = true;
  S.code = "DEMO";
  S.dest = DEMO_B;
  S.me = { name: "Asha", bike: 1 };
  S.riders = [["Asha", "Ravi"], ["Meera", "Kabir"], ["Dev", "Isha"]].flatMap((ns, i) => ns.map((name, j) => ({ id: i * 2 + j, name, bike: i + 1 })));
  let path = [DEMO_A, DEMO_B];
  try {
    const r = await (await fetch(`${OSRM}/route/v1/driving/${DEMO_A.lng},${DEMO_A.lat};${DEMO_B.lng},${DEMO_B.lat}?overview=full&geometries=geojson`)).json();
    path = r.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  } catch { toast("Routing server unreachable: demo uses a straight line"); }
  const L0 = pathLength(path), t0 = Date.now();
  const bikes = [{ start: 0.1, v: 1 }, { start: 0.07, v: 1.12 }, { start: 0.03, v: 0.9 }];
  const tick = () => {
    bikes.forEach((b, i) => {
      const p = along(path, L0 * (b.start + (b.v * (Date.now() - t0)) / 1000 / DEMO_SECONDS));
      S.pos[i + 1] = { ...p, t: Date.now() };
    });
    render();
  };
  enterTrip();
  tick();
  setInterval(tick, 1000);
}

// ---------- home ----------
$("goCreate").onclick = initCreate;
$("goDemo").onclick = () => (location.search = "?demo=1");
$("joinForm").onsubmit = (e) => { e.preventDefault(); location.search = "?t=" + $("codeIn").value.trim().toUpperCase(); };
document.querySelectorAll("[data-back]").forEach((b) => (b.onclick = home));
if (!sb) {
  $("noCfg").hidden = false;
  $("goCreate").disabled = true;
  $("joinForm").querySelector("button").disabled = true;
}
if (load("rt_last")) {
  $("resume").hidden = false;
  $("resume").href = "?t=" + load("rt_last");
  $("resume").textContent = "Resume trip " + load("rt_last");
}

// ---------- create ----------
let pick, pickMarker, dest;
function initCreate() {
  show("create");
  pick = L.map("pickmap").setView([20, 0], 2);
  tiles(pick);
  navigator.geolocation?.getCurrentPosition((p) => !dest && pick.setView([p.coords.latitude, p.coords.longitude], 12));
  pick.on("click", (e) => setDest({ lat: e.latlng.lat, lng: e.latlng.lng, name: "Dropped pin" }));
}
function setDest(d) {
  dest = d;
  pickMarker?.remove();
  pickMarker = L.marker([d.lat, d.lng]).addTo(pick);
  pick.setView([d.lat, d.lng], Math.max(pick.getZoom(), 13));
  $("destName").textContent = "📍 " + d.name;
  $("createBtn").disabled = false;
}
$("searchForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const rows = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent($("searchIn").value)}`)).json();
    $("results").replaceChildren(...rows.map((r) => {
      const li = el("li", "", r.display_name);
      li.onclick = () => { setDest({ lat: +r.lat, lng: +r.lon, name: r.display_name.split(",").slice(0, 2).join(",") }); $("results").replaceChildren(); };
      return li;
    }));
    if (!rows.length) toast("No results. Try the map instead.");
  } catch { toast("Search failed. Tap the map to drop a pin."); }
};
$("createBtn").onclick = async () => {
  $("createBtn").disabled = true;
  try { location.search = "?t=" + (await real.create(dest)); }
  catch (e) { toast("Couldn't create trip: " + e.message); $("createBtn").disabled = false; }
};

// ---------- join ----------
let sel = 0;
const rider = (name) => S.riders.find((r) => r.name.toLowerCase() === name.toLowerCase());
const isFull = (i, name) => S.riders.filter((r) => r.bike === i).length >= 2 && rider(name)?.bike !== i;
function renderBikes() {
  const name = $("nameIn").value.trim();
  if (rider(name)) sel = rider(name).bike; // same name = rejoining (e.g. new phone)
  else if (!sel || isFull(sel, name)) sel = [1, 2, 3].find((i) => !isFull(i, name)) || 0; // pre-pick a free bike
  $("bikePick").replaceChildren(...[1, 2, 3].map((i) => {
    const names = S.riders.filter((r) => r.bike === i).map((r) => r.name);
    const b = el("button", "bikeopt" + (sel === i ? " sel" : ""));
    b.disabled = isFull(i, name);
    const d = el("span", "dot", i);
    d.style.background = `var(--b${i})`;
    b.append(d, `Bike ${i} · ${names.join(" & ") || "empty"}${b.disabled ? " (full)" : ""}`);
    b.onclick = () => { sel = i; renderBikes(); };
    return b;
  }));
  $("joinBtn").disabled = !(name && sel && !isFull(sel, name));
}
$("nameIn").oninput = renderBikes;
$("joinBtn").onclick = async () => {
  const name = $("nameIn").value.trim();
  $("joinBtn").disabled = true;
  try {
    if (!rider(name)) ingestRider(await real.join(S.code, name, sel));
    S.me = { name, bike: sel };
    store("rt_me_" + S.code, JSON.stringify(S.me));
    store("rt_name", name);
    S.justJoined = true;
    enterTrip();
  } catch (e) { toast("Couldn't join: " + e.message); $("joinBtn").disabled = false; }
};

async function openTrip(code) {
  S.code = code;
  let d;
  try { d = await real.load(code); } catch (e) { return toast("Couldn't reach the server: " + e.message); }
  if (!d) { toast("Trip not found"); return setTimeout(home, 1500); }
  S.dest = d.dest;
  d.riders.forEach(ingestRider);
  d.pos.forEach(ingestPos);
  try { S.me = JSON.parse(load("rt_me_" + code)); } catch {}
  if (S.me) return enterTrip();
  show("join");
  $("nameIn").value = load("rt_name") || "";
  $("joinCode").textContent = code;
  $("joinDest").textContent = S.dest.name;
  renderBikes();
}

// ---------- trip ----------
let map, destMarker;
const markers = {}, cards = {};
let routeLine, routeBusy = false;

function enterTrip() {
  show("trip");
  $("tripCode").textContent = S.code;
  $("demoBadge").hidden = !S.demo;
  $("gpsBtn").hidden = $("shareBtn").hidden = S.demo;
  map = L.map("tripmap", { zoomControl: false }).setView([S.dest.lat, S.dest.lng], 12);
  tiles(map);
  for (const ev of ["pointerdown", "wheel"]) map.getContainer().addEventListener(ev, () => (S.manual = true), { passive: true });
  destMarker = L.marker([S.dest.lat, S.dest.lng], { icon: L.divIcon({ className: "flag", html: "🏁", iconSize: [44, 44], iconAnchor: [22, 22] }) })
    .bindTooltip("Destination", { permanent: true, direction: "bottom", offset: [0, 20], className: "ptip" }).addTo(map);
  for (const i of [1, 2, 3]) {
    const c = el("div", "card");
    c.innerHTML = `<div class="dot" style="background:var(--b${i})">${i}</div><div class="info"><b class="t"></b><span class="d"></span><span class="sub f"></span><span class="sub s"></span></div><button class="btn small nav">Navigate to Bike</button>`;
    c.querySelector(".nav").onclick = () => S.pos[i] && window.open(gmapsUrl(S.pos[i]), "_blank");
    c.onclick = (e) => { // tap a card to look at that bike on the map
      if (e.target.closest("button") || !S.pos[i]) return;
      S.manual = true;
      map.flyTo([S.pos[i].lat, S.pos[i].lng], 15);
    };
    $("cards").append(c);
    cards[i] = c;
  }
  if (!S.demo) {
    real.watch(S.code);
    store("rt_last", S.code);
    if (load("rt_share_" + S.code)) { startGps(true); sharing && openTracker(); } // resume sharing after a reload
  }
  if (S.justJoined) {
    $("wBike").textContent = "Bike " + S.me.bike;
    $("welcome").hidden = false;
  }
  $("wShare").onclick = () => { $("welcome").hidden = true; startGps(); sharing && openTracker(); };
  $("darkBtn").onclick = openTracker;
  $("tExit").onclick = closeTracker;
  $("wView").onclick = () => ($("welcome").hidden = true);
  setInterval(render, 5000); // refresh "last seen" labels
  setInterval(refreshRoutes, 12000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && (sharing && requestWake(), render()));
  const labels = () => map.getContainer().classList.toggle("far", map.getZoom() < 12); // names overlap when zoomed out
  map.on("zoomend", labels);
  setTimeout(() => map.invalidateSize(), 100);
  render();
}

function fit(withDest) {
  S.lastFit = Date.now();
  const bikes = Object.values(S.pos).map((p) => [p.lat, p.lng]);
  const pts = withDest || !bikes.length ? [[S.dest.lat, S.dest.lng], ...bikes] : bikes;
  map.fitBounds(pts, { padding: [50, 50], maxZoom: 15 });
}
$("fitBtn").onclick = () => { S.manual = false; fit(true); };
$("mapBtn").onclick = () => {
  const min = $("panel").classList.toggle("min");
  $("mapBtn").textContent = min ? "📋" : "🗺";
  $("mapBtn").setAttribute("aria-label", min ? "Show details" : "Bigger map");
  setTimeout(() => map.invalidateSize(), 50);
};
$("navDest").onclick = () => window.open(gmapsUrl(S.dest), "_blank");
$("shareBtn").onclick = $("wInvite").onclick = async () => {
  const url = `${location.origin}${location.pathname}?t=${S.code}`;
  try { await navigator.share({ title: "RideTogether", text: `Join our ride! Code ${S.code}`, url }); }
  catch { navigator.clipboard?.writeText(url).then(() => toast("Link copied"), () => toast(url)); }
};

async function refreshRoutes() {
  const bikes = [1, 2, 3].filter((i) => S.pos[i]);
  if (!bikes.length || routeBusy) return;
  routeBusy = true;
  const pts = [...bikes.map((i) => S.pos[i]), S.dest];
  const q = pts.map((p) => `${p.lng},${p.lat}`).join(";");
  let get;
  try {
    const r = await (await fetch(`${OSRM}/table/v1/driving/${q}?annotations=duration,distance`)).json();
    if (r.code !== "Ok" || !r.distances) throw 0;
    get = (a, b) => {
      const m = r.distances[a][b], s = r.durations[a][b];
      return m == null || s == null ? estimate(pts[a], pts[b]) : { m, s };
    };
  } catch { get = (a, b) => estimate(pts[a], pts[b]); }
  S.eta = {};
  bikes.forEach((i, a) => {
    S.eta[i] = { dest: get(a, bikes.length) };
    bikes.forEach((j, b) => i !== j && (S.eta[i][j] = get(a, b)));
  });
  routeBusy = false;
  render();
  // draw my bike's road to the destination
  const mine = S.me && S.pos[S.me.bike];
  if (!mine) return;
  try {
    const r = await (await fetch(`${OSRM}/route/v1/driving/${mine.lng},${mine.lat};${S.dest.lng},${S.dest.lat}?overview=full&geometries=geojson`)).json();
    const line = r.routes[0].geometry.coordinates.map(([x, y]) => [y, x]);
    routeLine?.remove();
    routeLine = L.polyline(line, { color: getComputedStyle(document.documentElement).getPropertyValue(`--b${S.me.bike}`), weight: 5, opacity: 0.6 }).addTo(map);
  } catch {}
}

const sum = (e) => `${e.approx ? "~" : ""}${fmtDist(e.m)} · ${fmtTime(e.s)}`;

function render() {
  if (!map) return;
  const now = Date.now();
  for (const i of [1, 2, 3]) {
    const p = S.pos[i], c = cards[i];
    const names = S.riders.filter((r) => r.bike === i).map((r) => r.name).join(" & ");
    const mine = S.me?.bike === i;
    c.querySelector(".t").textContent = `Bike ${i}${names ? " · " + names : ""}${mine ? " (you)" : ""}`;
    const stale = p && now - p.t > STALE_MS;
    c.classList.toggle("stale", !p || stale);
    c.querySelector(".s").textContent = !p ? "Waiting for GPS…" : stale ? `Last seen ${fmtAge(now - p.t)}` : "Live";
    const e = S.eta[i];
    c.querySelector(".d").textContent = e?.dest ? `${sum(e.dest)} to destination` : p ? "Calculating…" : "";
    const from = !mine && S.eta[S.me?.bike]?.[i];
    c.querySelector(".f").textContent = from ? `${sum(from)} ${where(i) || "from your bike"}` : "";
    c.querySelector(".nav").hidden = mine || !p;
    if (p) {
      const first = S.riders.filter((r) => r.bike === i).map((r) => r.name.split(" ")[0]).join(" & ");
      if (!markers[i]) {
        markers[i] = L.marker([p.lat, p.lng], { zIndexOffset: mine ? 1000 : 0, icon: L.divIcon({ className: "pin" + (mine ? " me" : ""), html: `<div class="dot" style="background:var(--b${i});--ring:var(--b${i})">${i}</div>`, iconSize: [40, 40] }) })
          .bindTooltip(first, { permanent: true, direction: "bottom", offset: [0, 18], className: "ptip bike-tip" }).addTo(map);
      } else markers[i].setLatLng([p.lat, p.lng]).setTooltipContent(first);
      markers[i].getElement()?.classList.toggle("stale", stale);
    }
  }
  const mineEta = S.eta[S.me?.bike]?.dest;
  $("navDest").textContent = "Navigate to Destination" + (mineEta ? ` · ${sum(mineEta)}` : "");
  $("between").innerHTML = [[1, 2], [1, 3], [2, 3]]
    .filter(([a, b]) => S.eta[a]?.[b])
    .map(([a, b]) => `<span>Bike ${a} ↔ ${b}: ${sum(S.eta[a][b])}</span>`).join("");
  // keep everyone in view until the user pans/zooms themselves ("Fit all" turns it back on)
  updateAlert();
  if (Object.keys(S.pos).length && !S.manual && now - (S.lastFit || 0) > 8000) fit();
  const key = Object.keys(S.pos).join();
  if (key !== S.key) { S.key = key; refreshRoutes(); }
}

// ---------- GPS sharing (one phone per bike) ----------
let sharing = false, watchId, pushTimer, fix, wake;
const requestWake = async () => { try { wake = await navigator.wakeLock?.request("screen"); } catch {} };
$("gpsBtn").onclick = () => (sharing ? stopGps() : startGps());
function startGps(auto) {
  if (!navigator.geolocation) return toast("This browser has no GPS");
  const p = S.pos[S.me.bike];
  if (!auto && p && Date.now() - p.t < 8000 && !confirm("Another phone seems to be sharing for this bike. Share from this one anyway?")) return;
  sharing = true;
  store("rt_share_" + S.code, "1");
  watchId = navigator.geolocation.watchPosition(
    (pos) => (fix = pos),
    (e) => { if (e.code === 1) { toast("Location is blocked. Allow it in your browser settings."); stopGps(); } },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
  );
  pushTimer = setInterval(pushFix, 3000);
  requestWake();
  $("gpsBtn").classList.add("on");
  $("darkBtn").hidden = false;
  $("gpsBtn").textContent = `✅ Sharing Bike ${S.me.bike} · tap to stop`;
  toast("Sharing Bike " + S.me.bike + ". Keep this screen open on this phone.");
}
function stopGps() {
  sharing = false;
  store("rt_share_" + S.code, null);
  navigator.geolocation.clearWatch(watchId);
  clearInterval(pushTimer);
  wake?.release?.();
  fix = null;
  $("gpsBtn").classList.remove("on");
  $("darkBtn").hidden = true;
  closeTracker();
  $("gpsBtn").textContent = "📡 Share this bike's location";
}
function pushFix() {
  if (!fix) return;
  const row = { trip: S.code, bike: S.me.bike, lat: fix.coords.latitude, lng: fix.coords.longitude, speed: fix.coords.speed, updated_at: new Date().toISOString() };
  ingestPos(row);
  render();
  real.push(row).then(() => { S.lastPushOk = Date.now(); S.pushErr = false; }, () => (S.pushErr = true)); // next tick retries with a fresh fix
}

// ---------- group-split / lost-signal alert ----------
function updateAlert() {
  const now = Date.now(), mine = S.pos[S.me?.bike], msgs = [], keys = [];
  for (const i of [1, 2, 3]) {
    const p = S.pos[i];
    if (i === S.me?.bike || !p) continue;
    if (now - p.t > STALE_MS) { msgs.push(`Bike ${i} lost signal`); keys.push(i + "s"); }
    else if (mine && haversine(mine, p) > GAP_ALERT_M) { msgs.push(`Bike ${i} is ${fmtDist(haversine(mine, p))} away`); keys.push(i + "f"); }
  }
  S.alert = msgs.join(" · ");
  $("alert").hidden = !S.alert;
  $("alert").textContent = "⚠ " + S.alert;
  const key = keys.join();
  if (key && key !== S.alertKey) navigator.vibrate?.([200, 100, 200]);
  S.alertKey = key;
}
// "ahead of you" = less road left to the destination than your bike
const where = (j) => {
  const a = S.eta[S.me?.bike]?.dest?.m, b = S.eta[j]?.dest?.m;
  if (a == null || b == null) return "";
  return Math.abs(a - b) < 200 ? "beside you" : a > b ? "ahead of you" : "behind you";
};

// ---------- tracker mode: black glanceable screen for the phone that stays on the bike ----------
let trackerTimer;
function openTracker() {
  $("tracker").hidden = false;
  renderTracker();
  clearInterval(trackerTimer);
  trackerTimer = setInterval(renderTracker, 1000);
}
function closeTracker() {
  $("tracker").hidden = true;
  clearInterval(trackerTimer);
}
function renderTracker() {
  const now = Date.now(), me = S.me.bike, st = $("tState");
  if (!fix) { st.textContent = "Waiting for GPS fix…"; st.className = "warnc"; }
  else if (S.pushErr) { st.textContent = "⚠ No internet, retrying"; st.className = "bad"; }
  else { st.textContent = `📡 Sharing · sent ${Math.max(0, Math.round((now - (S.lastPushOk || now)) / 1000))}s ago`; st.className = "ok"; }
  $("tBike").textContent = `Bike ${me}`;
  $("tBike").style.color = `var(--b${me})`;
  const e = S.eta[me]?.dest;
  $("tDest").textContent = e ? `🏁 ${sum(e)}` : "🏁 …";
  $("tAlert").textContent = S.alert ? "⚠ " + S.alert : "";
  $("tOthers").replaceChildren(...[1, 2, 3].filter((i) => i !== me).map((i) => {
    const p = S.pos[i], f = S.eta[me]?.[i], row = el("div", "trow"), d = el("span", "dot", i);
    d.style.background = `var(--b${i})`;
    row.append(d, !p ? "waiting…" : now - p.t > STALE_MS ? "signal lost" : f ? `${sum(f)} ${where(i)}` : "…");
    return row;
  }));
}

// ---------- boot ----------
const params = new URLSearchParams(location.search);
if (params.get("demo")) startDemo();
else if (params.get("t") && sb) openTrip(params.get("t").toUpperCase());
else show("home");
