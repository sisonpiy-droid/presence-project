"""Freshroots demand planning: Raghav's 5 documented rules as a reorder-recommendation run.

Usage: python recommend.py [data_dir] [out_dir]
Recommends only. It never places a PO; Raghav approves every row.
"""
import csv
import html
import sys
from collections import defaultdict
from pathlib import Path

# Raghav's thresholds. Edit here, not in the logic below.
RULES = {
    "high_demand_ratio": 1.20,   # last 4 wks avg > 120% of 12-wk avg -> high demand
    "high_demand_qty_mult": 1.5,
    "festival_uplift": 1.25,     # applied to avg weekly sales before cover checks
    "cover_weeks": {"Low": (6, 14), "High": (3, 4)},  # (min, max) by Perishability; High = perishable
    "sharp_drop_ratio": 0.80,    # last 4 wks avg < 80% of 12-wk avg -> unusual, Raghav looks
    "min_history_weeks": 12,     # fewer weeks of sales -> treat as new launch, Raghav decides
}


def read(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def recommend(sku, weekly, on_hand, festival, rules=RULES):
    """sku: master row; weekly: units sorted oldest->newest; returns one recommendation dict."""
    last12, last4 = weekly[-12:], weekly[-4:]
    avg12, avg4 = sum(last12) / len(last12), sum(last4) / len(last4)
    adj = avg12 * (rules["festival_uplift"] if festival else 1)
    cover = on_hand / adj
    lo, hi = rules["cover_weeks"][sku["Perishability"]]
    stockout, over = cover < lo, cover > hi
    high = avg4 > rules["high_demand_ratio"] * avg12
    std = int(sku["Standard_Reorder_Qty"])
    flags = []

    if over and high:
        call, qty = "Review", 0
        reason = f"Conflict: overstock ({cover:.1f} wks > {hi}) but demand rising"
        flags.append("conflicting signals")
    elif stockout:
        qty = int(std * rules["high_demand_qty_mult"]) if high else std
        call = "Reorder now"
        reason = f"Cover {cover:.1f} wks < {lo}" + (" and demand high: 1.5x" if high else "")
    elif high:
        call, qty = "Reorder 1.5x", int(std * rules["high_demand_qty_mult"])
        reason = f"Last 4 wks {avg4 / avg12 - 1:+.0%} vs 12-wk avg"
    elif over:
        call, qty, reason = "Pause order", 0, f"Cover {cover:.1f} wks > {hi}"
    else:
        call, qty, reason = "OK", 0, f"Cover {cover:.1f} wks within {lo}-{hi}"

    if avg4 < rules["sharp_drop_ratio"] * avg12:
        flags.append("sharp drop (competitor scheme?)")
    if len(weekly) < rules["min_history_weeks"]:
        flags.append("short history (new launch?)")
    return {
        "SKU_ID": sku["SKU_ID"], "SKU_Name": sku["SKU_Name"], "Perishability": sku["Perishability"],
        "Units_On_Hand": on_hand, "Avg_4wk": round(avg4, 1), "Avg_12wk": round(avg12, 1),
        "Adj_Weekly_Demand": round(adj, 1), "Weeks_Cover": round(cover, 1),
        "Call": call, "Reorder_Qty": qty, "Reason": reason, "Needs_Raghav": "; ".join(flags),
    }


def run(data, rules=RULES):
    master = {r["SKU_ID"]: r for r in read(data / "sku_master.csv")}
    sales = defaultdict(list)
    for r in sorted(read(data / "weekly_sales.csv"), key=lambda r: (r["SKU_ID"], r["Week"])):
        sales[r["SKU_ID"]].append(int(r["Units_Sold"]))
    inv = {r["SKU_ID"]: r for r in read(data / "current_inventory.csv")}
    fest = {r["Year_Month"]: r["Is_Festival_Month"] == "TRUE" for r in read(data / "calendar.csv")}
    rows = []
    for sid, sku in master.items():
        as_of = inv[sid]["As_Of_Date"]
        festival = fest[as_of[:7]]
        rows.append(recommend(sku, sales[sid], int(inv[sid]["Units_On_Hand"]), festival, rules))
    return rows, as_of, festival


CHECKS = [
    ("01 Problem real", "Yes: ₹28–34 lakh/qtr lost to stockouts and write-offs"),
    ("02 Workflow repeated", "Yes: monthly today, can run twice weekly"),
    ("03 Input available", "Yes: SAP exports plus 5 documented rules"),
    ("04 Output valuable", "Yes: replaces ~2 days/month of manual pulls with a ranked action list"),
    ("05 Impact measurable", "Yes: baseline in ₹, target set below"),
    ("06 ROI worth it", "Yes: a 20% cut is about ₹6–7 lakh/qtr against a ₹15 lakh budget"),
    ("07 Failure risk OK", "Partly: bad reorder is costly, so a human approves every row"),
    ("08 Judgment protected", "Partly: the 15–20% edge cases are flagged to Raghav, not decided"),
    ("09 Owner clear", "Partly: Raghav approves, Priya feeds the data (to be confirmed)"),
]
DECISIONS = [
    ("Outcome", "Fewer stockouts and perishable write-offs; demand shifts reach procurement in days, not 3–4 weeks."),
    ("Baseline", "₹18–22 lakh/qtr stockouts + ₹10–12 lakh/qtr write-offs; monthly cycle on 3–4 week old data; ~2 days/month of manual pulls."),
    ("Workflow change", "Data pull automated; cycle twice weekly; tool recommends, Raghav approves, procurement orders only from the approved list."),
    ("Measurement", "Quarterly: lost-sales value, write-off value, % of recommendations Raghav overrides. Target: losses down 20–25% in two quarters."),
    ("Kill criterion", "Stop and redesign if overrides exceed 40% after 6 weeks, or losses are no better than baseline after one quarter, or the SAP export can't be automated."),
]
COLORS = {"Reorder now": "#f8d7da", "Reorder 1.5x": "#fff3cd", "Pause order": "#d6e4f5", "Review": "#e2d9f3", "OK": "#e6f4ea"}


def render(rows, as_of, festival):
    e = html.escape
    counts = defaultdict(int)
    for r in rows:
        counts[r["Call"]] += 1
    tiles = "".join(f"<span class=t style='background:{COLORS[c]}'><b>{n}</b> {e(c)}</span>" for c, n in counts.items())
    body = "".join(
        f"<tr style='background:{COLORS[r['Call']]}'><td>{r['SKU_ID']}</td><td>{e(r['SKU_Name'])}</td>"
        f"<td>{r['Perishability']}</td><td>{r['Units_On_Hand']}</td><td>{r['Avg_12wk']}</td><td>{r['Weeks_Cover']}</td>"
        f"<td><b>{r['Call']}</b></td><td>{r['Reorder_Qty'] or ''}</td><td>{e(r['Reason'])}</td><td>{e(r['Needs_Raghav'])}</td></tr>"
        for r in sorted(rows, key=lambda r: ("OK", "Pause order", "Reorder 1.5x", "Reorder now", "Review").index(r["Call"]), reverse=True)
    )
    li = lambda items: "".join(f"<li><b>{e(a)}:</b> {e(b)}</li>" for a, b in items)
    return f"""<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Freshroots Demand Planning</title>
<style>body{{font:15px system-ui;max-width:1100px;margin:2rem auto;padding:0 16px;color:#1a1a1a}}
table{{border-collapse:collapse;width:100%;font-size:13px}}td,th{{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left}}
.t{{display:inline-block;padding:4px 10px;margin:0 6px 6px 0;border-radius:6px}}.wrap{{overflow-x:auto}}li{{margin:4px 0}}</style>
<h1>Freshroots demand planning run</h1>
<p>Stock as of <b>{as_of}</b>. Festival uplift (+25%): <b>{'ON' if festival else 'off'}</b>. Recommendations only; Raghav approves before procurement orders.</p>
<p>{tiles}</p>
<div class=wrap><table><tr><th>SKU<th>Name<th>Perish.<th>On hand<th>Avg/wk (12w)<th>Weeks cover<th>Call<th>Reorder qty<th>Why<th>Needs Raghav</tr>{body}</table></div>
<h2>Why Demand Planning first: the 9 checks</h2><ul>{li(CHECKS)}</ul>
<p>Distributor Service fails check 03 (no query data exists). Operations Intelligence fails 04, 06 and 09 (a dashboard exists; nobody owns acting on it).</p>
<h2>5 pre-build decisions</h2><ul>{li(DECISIONS)}</ul>"""


if __name__ == "__main__":
    data = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / "data")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).parent / "out")
    out.mkdir(exist_ok=True)
    rows, as_of, festival = run(data)
    with open(out / "recommendations.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    (out / "summary.html").write_text(render(rows, as_of, festival), encoding="utf-8")
    for r in rows:
        print(f"{r['SKU_ID']} {r['Call']:<13} qty={r['Reorder_Qty']:<4} cover={r['Weeks_Cover']:<5} {r['Reason']} | {r['Needs_Raghav']}")
