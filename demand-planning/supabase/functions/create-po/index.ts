// Turns rows in purchase_orders into DRAFT purchase orders in Zoho Inventory.
// Not deployed yet, and not run against a real Zoho account: see supabase/README.md for going live.
//
// Trigger: a Database Webhook on purchase_orders (INSERT and UPDATE) that calls this function.
// Secrets: ZOHO_ACCOUNTS_URL, ZOHO_API_URL, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID
//   India example: ZOHO_ACCOUNTS_URL=https://accounts.zoho.in  ZOHO_API_URL=https://www.zohoapis.in/inventory/v1
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

async function zohoToken(): Promise<string> {
  const r = await fetch(`${env("ZOHO_ACCOUNTS_URL")}/oauth/v2/token`, {
    method: "POST",
    body: new URLSearchParams({
      refresh_token: env("ZOHO_REFRESH_TOKEN"),
      client_id: env("ZOHO_CLIENT_ID"),
      client_secret: env("ZOHO_CLIENT_SECRET"),
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("Zoho token: " + JSON.stringify(j));
  return j.access_token;
}

const zoho = async (token: string, path: string, init: RequestInit = {}) => {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${env("ZOHO_API_URL")}${path}${sep}organization_id=${env("ZOHO_ORG_ID")}`, {
    ...init,
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`Zoho ${r.status}: ${j.message ?? JSON.stringify(j)}`);
  return j;
};

Deno.serve(async (req) => {
  const { record } = await req.json(); // Database Webhook body
  const live = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ORG_ID"].every(env);
  if (!live) return new Response("Zoho secrets not set: staying in dry-run", { status: 200 });

  const po = record;
  try {
    const token = await zohoToken();

    if (po.status === "dry_run") {
      if (po.warnings?.length) throw new Error("Not sent: " + po.warnings.join("; "));
      // Zoho creates purchase orders as drafts by default. Procurement checks and issues them in Zoho.
      const j = await zoho(token, "/purchaseorders", { method: "POST", body: JSON.stringify(po.payload) });
      await db.from("purchase_orders").update({
        status: "draft_created",
        zoho_po_id: j.purchaseorder.purchaseorder_id,
        zoho_po_number: j.purchaseorder.purchaseorder_number,
        error: null,
      }).eq("decision_id", po.decision_id);
    } else if (po.status === "void_requested" && po.zoho_po_id) {
      // Raghav undid the approval: remove the draft. Zoho refuses this once the PO has been issued, and the error is kept.
      await zoho(token, `/purchaseorders/${po.zoho_po_id}`, { method: "DELETE" });
      await db.from("purchase_orders").update({ status: "voided", error: null }).eq("decision_id", po.decision_id);
    }
  } catch (e) {
    await db.from("purchase_orders").update({ status: po.status === "void_requested" ? "void_requested" : "failed", error: String(e.message ?? e) })
      .eq("decision_id", po.decision_id);
  }
  return new Response("ok");
});
