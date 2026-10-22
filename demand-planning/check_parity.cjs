// Fails if the JS rules disagree with the Python run (out/recommendations.csv).
const fs = require('fs'), h = fs.readFileSync(__dirname + '/app.template.html', 'utf8');
eval(h.match(/<script id="core">([\s\S]*?)<\/script>/)[1] + ';globalThis.X={parseCSV,compute,R0,validate}');
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
console.log(bad ? 'FAIL' : 'validate ok');
process.exit(bad ? 1 : 0);
