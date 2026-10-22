// Fails if the JS rules disagree with the Python run (out/recommendations.csv).
const fs = require('fs'), h = fs.readFileSync(__dirname + '/app.template.html', 'utf8');
eval(h.match(/<script id="core">([\s\S]*?)<\/script>/)[1] + ';globalThis.X={parseCSV,compute,R0}');
const rd = n => X.parseCSV(fs.readFileSync(`${__dirname}/data/${n}.csv`, 'utf8'));
const out = X.compute({sales: rd('weekly_sales'), master: rd('sku_master'), inv: rd('current_inventory'), cal: rd('calendar')}, X.R0, null);
const py = X.parseCSV(fs.readFileSync(__dirname + '/out/recommendations.csv', 'utf8'));
let bad = 0;
out.rows.forEach((r, i) => { const p = py[i];
  if (r.id !== p.SKU_ID || r.call !== p.Call || r.qty !== +p.Reorder_Qty || r.cover.toFixed(1) !== (+p.Weeks_Cover).toFixed(1)) { bad++; console.log('MISMATCH', r.id, r.call, r.qty, r.cover.toFixed(1), p); } });
console.log(bad ? 'FAIL' : `ok: ${out.rows.length} SKUs match Python`);
process.exit(bad ? 1 : 0);
