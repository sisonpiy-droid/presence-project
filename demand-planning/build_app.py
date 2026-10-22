"""Bake the sample CSVs into app.template.html -> app.html (a single file Raghav can open offline)."""
import json
from pathlib import Path

d = Path(__file__).parent
read = lambda n: (d / "data" / n).read_text(encoding="utf-8")
sample = {"sales": read("weekly_sales.csv"), "master": read("sku_master.csv"),
          "inv": read("current_inventory.csv"), "cal": read("calendar.csv")}
(d / "app.html").write_text((d / "app.template.html").read_text(encoding="utf-8")
                            .replace("__SAMPLE__", json.dumps(sample)), encoding="utf-8")
