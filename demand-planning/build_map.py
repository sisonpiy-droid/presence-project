"""Generate system-map.html: the components map and the workflow for the demand planning system."""
from html import escape as e
from pathlib import Path

NAVY, INK, MUTE = "#1f3556", "#1b2a41", "#6b7280"
DASH = ' stroke-dasharray="5 4"'
FILL = {"blue": ("#dbe8fb", "#8fb3e6"), "yellow": ("#fbe7a6", "#e2b93b"), "green": ("#d3ecd2", "#7fbf7c"),
        "orange": ("#f7d3a1", "#e0a24f"), "pink": ("#f6cfdd", "#d98aa8"), "grey": ("#f1f2f4", "#a7adb7")}


def box(x, y, w, h, lines, color, dash=False):
    f, s = FILL[color]
    t = "".join(f'<tspan x="{x + w / 2}" dy="{16 if i else 0}">{e(l)}</tspan>' for i, l in enumerate(lines))
    ty = y + h / 2 - (len(lines) - 1) * 8 + 4.5
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="9" fill="{f}" stroke="{s}" stroke-width="2"'
            f'{DASH if dash else ""}/><text x="{x + w / 2}" y="{ty}" text-anchor="middle" '
            f'font-size="12.5" font-weight="600" fill="{INK}">{t}</text>')


def diamond(cx, cy, w, h, lines, color="yellow"):
    f, s = FILL[color]
    pts = f"{cx},{cy - h / 2} {cx + w / 2},{cy} {cx},{cy + h / 2} {cx - w / 2},{cy}"
    t = "".join(f'<tspan x="{cx}" dy="{14 if i else 0}">{e(l)}</tspan>' for i, l in enumerate(lines))
    return (f'<polygon points="{pts}" fill="{f}" stroke="{s}" stroke-width="2"/><text x="{cx}" y="{cy - (len(lines) - 1) * 7 + 4}" '
            f'text-anchor="middle" font-size="12" font-weight="600" fill="{INK}">{t}</text>')


def arrow(pts, dash=True, label=None, color="#667085"):
    d = "M" + " L".join(f"{x},{y}" for x, y in pts)
    out = (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.6"{DASH if dash else ""} marker-end="url(#ah)"/>')
    if label:
        (x1, y1), (x2, y2) = pts[0], pts[1]
        lx, ly = (x1 + 6, y1 + 16) if x1 == x2 else (x1 + 4, y1 - 6)
        out += f'<text x="{lx}" y="{ly}" font-size="11.5" font-weight="700" fill="{color}">{e(label)}</text>'
    return out


DEFS = f'<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#667085"/></marker></defs>'


def components():
    LW, CW, RH, HH, BW, BH = 190, 200, 96, 56, 176, 72
    heads = ["Trigger", "Collect", "Rules", "Decision", "Store", "Output"]
    rows = [("Priya", "Analyst"), ("SAP ERP", "Export"), ("Data check", "Code"), ("Zoho", "Purchase orders"), ("Rules", "Code, no AI"),
            ("Flags", "Code"), ("Raghav", "Planner"), ("Log", "Browser storage"), ("Deepa", "Sponsor"), ("Reorder Desk", "Web page"), ("Procurement", "Orders")]
    W, H = LW + CW * len(heads), HH + RH * len(rows)
    cells = {  # name: (row, col, lines, color, dashed)
        "P": (0, 0, ["Mon + Thu: exports", "4 files from SAP"], "yellow", False),
        "SAP": (1, 1, ["Sales, SKU master,", "stock, calendar CSVs"], "blue", False),
        "DC": (2, 1, ["Catches missing SKUs,", "stale stock, duplicates"], "blue", False),
        "Z": (3, 1, ["Open POs: not", "connected yet (gap)"], "grey", True),
        "ZP": (3, 5, ["Draft PO in Zoho per", "approval (dry run until", "Zoho is connected)"], "orange", False),
        "RE": (4, 2, ["Raghav's 5 rules: cover,", "1.5x demand, festival", "+25%, perishable"], "yellow", False),
        "FL": (5, 2, ["Conflicts, sharp drops,", "new launches go", "to Raghav"], "yellow", False),
        "RG": (6, 3, ["Approves or overrides", "each row, notes why"], "yellow", False),
        "LOG": (7, 4, ["Decision log: call,", "qty, override, time", "(in this browser)"], "green", False),
        "DP": (8, 5, ["Weekly: override rate", "vs 40% limit, losses", "vs baseline"], "orange", False),
        "DK": (9, 5, ["Today's order list,", "table, CSV exports"], "orange", False),
        "PR": (10, 5, ["Checks the draft PO", "in Zoho, then issues it"], "orange", False),
    }
    g = {k: (LW + c * CW + (CW - BW) / 2, HH + r * RH + (RH - BH) / 2) for k, (r, c, *_ ) in cells.items()}
    L = lambda k: (g[k][0], g[k][1] + BH / 2); R = lambda k: (g[k][0] + BW, g[k][1] + BH / 2)
    T = lambda k: (g[k][0] + BW / 2, g[k][1]); B = lambda k: (g[k][0] + BW / 2, g[k][1] + BH)

    def elbow(a, b, dx):
        (x1, y1), (x2, y2) = R(a), L(b)
        return [(x1, y1), (dx, y1), (dx, y2), (x2, y2)]
    s = [f'<svg viewBox="0 0 {W} {H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,Segoe UI,sans-serif">{DEFS}',
         f'<rect width="{W}" height="{H}" fill="#fdfdf9"/>']
    for i, (n, sub) in enumerate(rows):
        y = HH + i * RH
        s.append(f'<rect x="{LW}" y="{y}" width="{W - LW}" height="{RH}" fill="{"#f3f4fa" if i % 2 else "#fdfdf9"}"/>')
        s.append(f'<rect x="0" y="{y}" width="{LW}" height="{RH}" fill="{NAVY}" stroke="#2c4570"/><text x="{LW / 2}" y="{y + RH / 2 - 2}" text-anchor="middle" font-size="15" font-weight="700" fill="#fff">{e(n)}</text>'
                 f'<text x="{LW / 2}" y="{y + RH / 2 + 16}" text-anchor="middle" font-size="12" fill="#c5d0e3">({e(sub)})</text>')
    for j in range(len(heads) + 1):
        s.append(f'<line x1="{LW + j * CW}" y1="{HH}" x2="{LW + j * CW}" y2="{H}" stroke="#e3e6ec"/>')
    s.append(f'<rect width="{W}" height="{HH}" fill="{NAVY}"/><text x="{LW / 2}" y="{HH / 2 + 6}" text-anchor="middle" font-size="17" font-weight="700" fill="#fff">Actor</text>')
    for j, h in enumerate(heads):
        s.append(f'<text x="{LW + j * CW + CW / 2}" y="{HH / 2 + 6}" text-anchor="middle" font-size="17" font-weight="700" fill="#fff">{h}</text>')
    s += [arrow(elbow("P", "SAP", L("SAP")[0] - 12)), arrow([B("SAP"), T("DC")]), arrow([T("Z"), B("DC")], color="#9aa1ad"),
          arrow(elbow("DC", "RE", L("RE")[0] - 12)), arrow([B("RE"), T("FL")]), arrow(elbow("FL", "RG", L("RG")[0] - 12)),
          arrow(elbow("RG", "LOG", L("LOG")[0] - 12)), arrow(elbow("LOG", "DP", L("DP")[0] - 18)),
          arrow(elbow("RG", "DK", L("DK")[0] - 6)), arrow(elbow("RG", "ZP", L("ZP")[0] - 12)), arrow([B("DK"), T("PR")])]
    for k, (_, _, lines, color, dash) in cells.items():
        s.append(box(*g[k], BW, BH, lines, color, dash))
    s.append("</svg>")
    return "".join(s)


def workflow():
    LW, CW, LH, TOP = 130, 172, 110, 40
    lanes = ["Priya", "Reorder Desk", "Raghav", "Procurement", "Deepa"]
    ncol = 8
    W, H = LW + CW * ncol, TOP + LH * len(lanes) + 70
    cx = lambda c: LW + CW * c + CW / 2
    cy = lambda l: TOP + LH * l + LH / 2
    bw, bh = 132, 62
    P = lambda l, c: (cx(c), cy(l))
    s = [f'<svg viewBox="0 0 {W} {H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,Segoe UI,sans-serif">{DEFS}',
         f'<rect width="{W}" height="{H}" fill="#fdfdf9"/>']
    for i, n in enumerate(lanes):
        y = TOP + i * LH
        s.append(f'<rect x="{LW}" y="{y}" width="{W - LW}" height="{LH}" fill="{"#f3f4fa" if i % 2 else "#fdfdf9"}"/>'
                 f'<rect x="0" y="{y}" width="{LW}" height="{LH}" fill="{NAVY}" stroke="#2c4570"/>'
                 f'<text x="{LW / 2}" y="{y + LH / 2 + 5}" text-anchor="middle" font-size="15" font-weight="700" fill="#fff">{e(n)}</text>')
    s.append(f'<rect width="{W}" height="{TOP}" fill="{NAVY}"/><text x="14" y="26" font-size="14" font-weight="700" fill="#fff">Twice-weekly cycle (Mon + Thu), left to right</text>')
    items = {"A": (0, 0, ["Mon + Thu: export", "4 files from SAP"], "yellow"), "B": (1, 1, ["Drop files into the", "desk; checks run"], "blue"),
             "FX": (0, 2, ["Fix the export,", "export again"], "yellow"), "C": (1, 3, ["Rules give every SKU", "a call and a reason"], "blue"),
             "F": (1, 4, ["Flag conflicts, drops,", "new launches"], "blue"), "G": (2, 5, ["Approve or override", "each row, log why"], "yellow"),
             "H": (3, 6, ["Draft PO in Zoho:", "check it, then issue"], "orange"), "I": (4, 6, ["Weekly: override rate", "and losses vs baseline"], "orange"),
             "ST": (3, 7, ["Stop and redesign", "the rules"], "pink")}
    pos = {k: P(l, c) for k, (l, c, *_) in items.items()}
    D1, D2 = P(1, 2), P(4, 7)
    s += [arrow([(pos["A"][0], pos["A"][1] + bh / 2), (pos["A"][0], pos["B"][1]), (pos["B"][0] - bw / 2, pos["B"][1])], dash=False),
          arrow([(pos["B"][0] + bw / 2, pos["B"][1]), (D1[0] - 68, D1[1])], dash=False),
          arrow([(D1[0], D1[1] - 38), (pos["FX"][0], pos["FX"][1] + bh / 2)], dash=False, label="no"),
          arrow([(pos["FX"][0] - bw / 2, pos["FX"][1]), (pos["B"][0], pos["FX"][1]), (pos["B"][0], pos["B"][1] - bh / 2)], dash=False),
          arrow([(D1[0] + 68, D1[1]), (pos["C"][0] - bw / 2, pos["C"][1])], dash=False, label="yes"),
          arrow([(pos["C"][0] + bw / 2, pos["C"][1]), (pos["F"][0] - bw / 2, pos["F"][1])], dash=False),
          arrow([(pos["F"][0] + bw / 2, pos["F"][1]), (pos["G"][0], pos["F"][1]), (pos["G"][0], pos["G"][1] - bh / 2)], dash=False),
          arrow([(pos["G"][0] + bw / 2, pos["G"][1]), (pos["H"][0], pos["G"][1]), (pos["H"][0], pos["H"][1] - bh / 2)], dash=False),
          arrow([(pos["G"][0], pos["G"][1] + bh / 2), (pos["G"][0], pos["I"][1]), (pos["I"][0] - bw / 2, pos["I"][1])], dash=False),
          arrow([(pos["I"][0] + bw / 2, pos["I"][1]), (D2[0] - 70, D2[1])], dash=False),
          arrow([(D2[0], D2[1] - 38), (pos["ST"][0], pos["ST"][1] + bh / 2)], dash=False, label="yes"),
          arrow([(D2[0], D2[1] + 38), (D2[0], H - 28), (pos["A"][0], H - 28), (pos["A"][0], pos["A"][1] + bh / 2 + 4)])]
    s.append(f'<text x="{pos["A"][0] + 10}" y="{H - 34}" font-size="11.5" font-weight="700" fill="#667085">no: next cycle (back to Priya)</text>')
    for k, (_, _, lines, color) in items.items():
        s.append(box(pos[k][0] - bw / 2, pos[k][1] - bh / 2, bw, bh, lines, color))
    s.append(diamond(*D1, 136, 76, ["All checks", "pass?"]))
    s.append(diamond(*D2, 140, 76, [">40% overrides", "after 6 weeks?"]))
    s.append("</svg>")
    return "".join(s)


PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Freshroots Demand Planning Map</title>
<style>body{margin:0;background:#f6f5f1;color:#1b2a41;font:15px system-ui,Segoe UI,sans-serif}.w{max-width:1400px;margin:0 auto;padding:28px 20px 50px}
h1{font-size:34px;margin:0;color:#1f3556}.sub{color:#6b7280;margin:4px 0 18px}h2{margin:34px 0 4px;color:#1f3556}
.sc{overflow-x:auto;border:2px solid #1f3556;border-radius:4px;background:#fff}.sc svg{min-width:900px;display:block}
.note{background:#f8e7b4;border:1px solid #e2b93b;border-radius:14px;padding:14px 18px;margin-top:16px;font-weight:600;text-align:center}</style></head>
<body><div class="w"><h1>Demand Planning · Components Map</h1>
<div class="sub">A planner's week: trigger → collect → judge → decide → store → deliver</div>
<div class="sc">__COMP__</div>
<div class="note">No AI in the loop: fixed rules in code decide every call. Raghav's approval only creates a draft PO: procurement checks it and issues it in Zoho.</div>
<h2>Workflow</h2><div class="sub">One cycle, who does what, and where it stops or loops. Dashed grey = not connected yet (Zoho POs).</div>
<div class="sc">__FLOW__</div></div></body></html>"""

if __name__ == "__main__":
    (Path(__file__).parent / "system-map.html").write_text(PAGE.replace("__COMP__", components()).replace("__FLOW__", workflow()), encoding="utf-8")
