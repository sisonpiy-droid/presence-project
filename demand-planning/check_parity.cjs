// Fails if the JS rules disagree with the Python run (out/recommendations.csv).
const fs = require('fs'), h = fs.readFileSync(__dirname + '/app.template.html', 'utf8');
eval(h.match(/<script id="core">([\s\S]*?)<\/script>/)[1] + ';globalThis.X={parseCSV,compute,R0,validate,makeCloud,buildPO,reconcilePOs}');
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
  if (post.headers.Authorization !== 'Bearer ' + cfg.key) { bad++; console.log('legacy anon key must also be sent as Bearer'); }
  calls.length = 0; await X.makeCloud(reply(true, [])).flush({...cfg, key: 'sb_publishable_' + 'x'.repeat(20)}, {[key]: dec}, {});
  if (calls[0].headers.Authorization || !calls[0].headers.apikey.startsWith('sb_publishable_')) { bad++; console.log('publishable key must be apikey only', calls[0].headers); }
  calls.length = 0; await c.flush(cfg, {[key]: dec}, snap);
  if (calls.length) { bad++; console.log('unchanged rows should not be re-sent'); }
  await c.flush(cfg, {}, snap);
  if (calls[0].method !== 'DELETE' || !calls[0].url.endsWith('decisions?id=eq.2026-10-19%7CSKU001')) { bad++; console.log('delete shape wrong', calls[0]); }
  const row = {id: key, status: 'approved', final_call: 'Reorder now', final_qty: 750, rec_call: 'Reorder now', rec_qty: 750, note: null, decided_at: 't'};
  const got = await X.makeCloud(reply(true, [row])).load(cfg);
  if (got[key].call !== 'Reorder now' || got[key].qty !== 750 || got[key].note !== undefined) { bad++; console.log('load mapping wrong', got); }
  let threw = false; try { await X.makeCloud(reply(false, [])).load(cfg); } catch (e) { threw = /401/.test(e.message); }
  if (!threw) { bad++; console.log('http errors must throw'); }
  // loadData: rows from the database must produce the same recommendations as the CSVs.
  const snake = {sku_master: D.master.map(r => ({sku_id: r.SKU_ID, sku_name: r.SKU_Name, category: r.Category, perishability: r.Perishability, standard_reorder_qty: +r.Standard_Reorder_Qty, unit_of_measure: r.Unit_of_Measure, distributor_id: r.Distributor_ID})),
    weekly_sales: D.sales.map(r => ({sku_id: r.SKU_ID, week: r.Week, units_sold: +r.Units_Sold})),
    current_inventory: D.inv.map(r => ({sku_id: r.SKU_ID, location: r.Location, units_on_hand: +r.Units_On_Hand, as_of_date: r.As_Of_Date})),
    calendar: D.cal.map(r => ({year: +r.Year, month: +r.Month, year_month: r.Year_Month, is_festival_month: r.Is_Festival_Month === 'TRUE'}))};
  const paged = []; // also proves paging: serve 1000-row pages for a table bigger than one page
  const big = Array.from({length: 2300}, (_, i) => ({sku_id: 'S' + i}));
  const fxp = async (url, o) => { paged.push(o.headers.Range); const [a, b] = o.headers.Range.split('-').map(Number); return {ok: true, status: 200, json: async () => big.slice(a, b + 1), text: async () => ''}; };
  const allRows = await X.makeCloud(fxp).all(cfg, 'sku_master', 'sku_id');
  if (allRows.length !== 2300 || paged.join() !== '0-999,1000-1999,2000-2999') { bad++; console.log('paging wrong', allRows.length, paged); }
  const fxd = async (url) => ({ok: true, status: 200, json: async () => snake[url.match(/v1\/(\w+)\?/)[1]], text: async () => ''});
  const loaded = await X.makeCloud(fxd).loadData(cfg);
  const a = JSON.stringify(X.compute(loaded, X.R0, null).rows.map(r => [r.id, r.call, r.qty, r.cover.toFixed(2)])), b = JSON.stringify(X.compute(D, X.R0, null).rows.map(r => [r.id, r.call, r.qty, r.cover.toFixed(2)]));
  if (a !== b) { bad++; console.log('database data gives different recommendations'); }
  // Purchase orders: one draft per approved order, kept in step with decisions.
  const rowsNow = X.compute(D, X.R0, null).rows, asof = '2026-10-19', byId = Object.fromEntries(rowsNow.map(r => [r.id, r]));
  const k1 = asof + '|SKU001', k2 = asof + '|SKU002', k3 = '2026-10-12|SKU003';
  const dA = {status: 'approved', call: 'Reorder now', qty: 750, recCall: 'Reorder now', recQty: 750, at: '2026-10-22T09:00:00Z'};
  const zm = {SKU001: {zoho_item_id: 'I1', zoho_vendor_id: 'V1', rate: '12.5'}};
  const po = X.buildPO(byId.SKU001, dA, zm, k1);
  if (po.payload.vendor_id !== 'V1' || po.payload.line_items[0].item_id !== 'I1' || po.payload.line_items[0].quantity !== 750 || po.payload.line_items[0].rate !== 12.5
      || po.payload.reference_number !== k1 || po.payload.date !== '2026-10-22' || po.status !== 'dry_run' || po.warnings.length) { bad++; console.log('buildPO wrong', po); }
  if (X.buildPO(byId.SKU002, dA, {}, k2).warnings.length !== 2) { bad++; console.log('missing mapping must warn for item and vendor'); }
  let rc = X.reconcilePOs(rowsNow, {[k1]: dA, [k2]: {...dA, qty: 0, call: 'OK'}, [k3]: dA}, zm, {}, asof);
  if (rc.up.length !== 1 || rc.up[0].decision_id !== k1 || rc.rm.length || rc.vd.length) { bad++; console.log('only qty>0 decisions of this run make a PO', rc); }
  const pos1 = {[k1]: rc.up[0]};
  rc = X.reconcilePOs(rowsNow, {[k1]: dA}, zm, pos1, asof);
  if (rc.up.length || rc.rm.length) { bad++; console.log('no change must do nothing'); }
  rc = X.reconcilePOs(rowsNow, {[k1]: {...dA, qty: 400}}, zm, pos1, asof);
  if (rc.up.length !== 1 || rc.up[0].quantity !== 400) { bad++; console.log('changed qty must refresh the PO'); }
  rc = X.reconcilePOs(rowsNow, {}, zm, pos1, asof);
  if (rc.rm.join() !== k1) { bad++; console.log('undo must delete a dry-run PO', rc); }
  rc = X.reconcilePOs(rowsNow, {}, zm, {[k1]: {...pos1[k1], status: 'draft_created'}}, asof);
  if (rc.vd.join() !== k1 || rc.rm.length) { bad++; console.log('undo must ask to void a real Zoho draft, not delete it', rc); }
  const pc = []; const fxc = async (url, o) => { pc.push({url, ...o}); return {ok: true, status: 200, json: async () => [], text: async () => ''}; };
  const cl = X.makeCloud(fxc);
  await cl.savePOs(cfg, [po]);
  const sent = JSON.parse(pc[0].body)[0];
  if (!pc[0].url.endsWith('purchase_orders?on_conflict=decision_id') || sent.zoho_po_id !== undefined || sent.payload.vendor_id !== 'V1') { bad++; console.log('savePOs shape wrong', pc[0]); }
  await cl.deletePOs(cfg, [k1, k2]);
  if (pc[1].method !== 'DELETE' || !pc[1].url.endsWith('decision_id=in.' + encodeURIComponent('("' + k1 + '","' + k2 + '")'))) { bad++; console.log('deletePOs shape wrong', pc[1].url); }
  await cl.voidPOs(cfg, [k1]);
  if (pc[2].method !== 'PATCH' || JSON.parse(pc[2].body).status !== 'void_requested') { bad++; console.log('voidPOs shape wrong'); }
  console.log(bad ? 'FAIL' : 'supabase ok');
  process.exit(bad ? 1 : 0);
})();
