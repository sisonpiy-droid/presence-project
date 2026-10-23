// Fails if the JS rules disagree with the Python run (out/recommendations.csv).
const fs = require('fs'), h = fs.readFileSync(__dirname + '/app.template.html', 'utf8');
eval(h.match(/<script id="core">([\s\S]*?)<\/script>/)[1] + ';globalThis.X={parseCSV,compute,R0,validate,makeCloud}');
const rd = n => X.parseCSV(fs.readFileSync(`${__dirname}/data/${n}.csv`, 'utf8'));
const out = X.compute({sales: rd('weekly_sales'), master: rd('sku_master'), inv: rd('current_inventory'), cal: rd('calendar')}, X.R0, null);
const py = X.parseCSV(fs.readFileSync(__dirname + '/out/recommendations.csv', 'utf8'));
let bad = 0;
out.rows.forEach((r, i) => { const p = py[i];
  if (r.id !== p.SKU_ID || r.call !== p.Call || r.qty !== +p.Reorder_Qty || r.cover.toFixed(1) !== (+p.Weeks_Cover).toFixed(1)) { bad++; console.log('MISMATCH', r.id, r.call, r.qty, r.cover.toFixed(1), p); } });
console.log(bad ? 'FAIL' : `ok: ${out.rows.length} SKUs match Python`);

// Priya's data checks: clean sample passes; broken data is caught.
const D = {sales: rd('weekly_sales'), master: rd('sku_master'), inv: rd('current_inventory'), cal: rd('calendar')};
const lv = (D, today) => X.validate(D, X.R0, new Date(today)).map(c => c.lv);
if (lv(D, '2026-10-22').some(l => l !== 'ok')) { bad++; console.log('clean data should pass', X.validate(D, X.R0, new Date('2026-10-22'))); }
const broken = {...D, inv: D.inv.slice(1), sales: D.sales.concat([{...D.sales[0]}, {SKU_ID: 'SKU002', Week: '2026-W42', Units_Sold: '-5'}]), cal: []};
const t = X.validate(broken, X.R0, new Date('2026-11-20')).map(c => c.lv + ':' + c.t).join(' | ');
for (const must of ['bad:SKUs in the master with no inventory', 'bad:1 rows with blank', 'warn:2 duplicate', 'bad:Inventory is as of', 'bad:Calendar has no row'])
  if (!t.includes(must)) { bad++; console.log('validate missed:', must); }

// Supabase client: request shapes against a fake fetch.
(async () => {
  const calls = [], reply = (ok, body) => async (url, o) => { calls.push({url, ...o}); return {ok, status: ok ? 200 : 401, json: async () => body, text: async () => 'denied'}; };
  const cfg = {url: 'https://x.supabase.co/', key: 'k'.repeat(30)}, key = '2026-10-19|SKU001';
  const dec = {status: 'overridden', call: 'OK', qty: 0, recCall: 'Reorder now', recQty: 750, note: 'promo ended', at: '2026-10-22T10:00:00Z'};
  let c = X.makeCloud(reply(true, []));
  const snap = await c.flush(cfg, {[key]: dec}, {});
  const post = calls[0], body = JSON.parse(post.body);
  if (post.method !== 'POST' || post.url !== 'https://x.supabase.co/rest/v1/decisions?on_conflict=id' || post.headers.apikey !== cfg.key || !post.headers.Prefer.includes('merge-duplicates')
      || body[0].id !== key || body[0].sku_id !== 'SKU001' || body[0].as_of !== '2026-10-19' || body[0].rec_call !== 'Reorder now' || body[0].final_qty !== 0) { bad++; console.log('upsert shape wrong', post); }
  calls.length = 0; await c.flush(cfg, {[key]: dec}, snap);
  if (calls.length) { bad++; console.log('unchanged rows should not be re-sent'); }
  await c.flush(cfg, {}, snap);
  if (calls[0].method !== 'DELETE' || !calls[0].url.endsWith('decisions?id=eq.2026-10-19%7CSKU001')) { bad++; console.log('delete shape wrong', calls[0]); }
  const row = {id: key, status: 'approved', final_call: 'Reorder now', final_qty: 750, rec_call: 'Reorder now', rec_qty: 750, note: null, decided_at: 't'};
  const got = await X.makeCloud(reply(true, [row])).load(cfg);
  if (got[key].call !== 'Reorder now' || got[key].qty !== 750 || got[key].note !== undefined) { bad++; console.log('load mapping wrong', got); }
  let threw = false; try { await X.makeCloud(reply(false, [])).load(cfg); } catch (e) { threw = /401/.test(e.message); }
  if (!threw) { bad++; console.log('http errors must throw'); }
  console.log(bad ? 'FAIL' : 'supabase ok');
  process.exit(bad ? 1 : 0);
})();
