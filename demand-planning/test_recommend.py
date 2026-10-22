from recommend import recommend

LOW = {"SKU_ID": "T", "SKU_Name": "t", "Perishability": "Low", "Standard_Reorder_Qty": "100"}
HIGH = dict(LOW, Perishability="High")
flat = [100] * 12


def call(sku, weekly, stock, festival=False):
    return recommend(sku, weekly, stock, festival)


def test_rules():
    assert call(LOW, flat, 1000)["Call"] == "OK"                      # 10 wks cover
    r = call(LOW, flat, 500)                                          # 5 < 6
    assert (r["Call"], r["Reorder_Qty"]) == ("Reorder now", 100)
    assert call(LOW, flat, 1500)["Call"] == "Pause order"             # 15 > 14
    r = call(LOW, [100] * 8 + [150] * 4, 1000)                        # avg4 150 vs avg12 117: high
    assert (r["Call"], r["Reorder_Qty"]) == ("Reorder 1.5x", 150)
    assert call(LOW, flat, 1000, festival=True)["Weeks_Cover"] == 8.0  # 1000 / 125
    assert call(HIGH, flat, 500)["Call"] == "Pause order"             # perishable max 4
    assert call(HIGH, flat, 250)["Call"] == "Reorder now"             # perishable min 3
    assert call(LOW, [100] * 8 + [150] * 4, 2000)["Call"] == "Review"  # overstock + rising
    assert "short history" in call(LOW, [100] * 6, 1000)["Needs_Raghav"]
    assert "sharp drop" in call(LOW, [100] * 8 + [50] * 4, 1000)["Needs_Raghav"]


if __name__ == "__main__":
    test_rules()
    print("ok")
