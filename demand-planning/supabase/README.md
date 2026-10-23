# Supabase and Zoho setup

Run these in order in the Supabase SQL editor: `schema.sql` (decisions), `seed.sql` (SKU data), `po.sql` (purchase orders and the Zoho mapping).

## How a purchase order is made

Every approval with a quantity creates one row in `purchase_orders`, holding the exact body that Zoho's create-purchase-order call needs. Overriding to a different quantity updates it, and undoing the approval removes it.

| status | meaning |
|---|---|
| `dry_run` | Created by the app. Nothing has been sent to Zoho. This is the only status until Zoho is connected. |
| `draft_created` | The Edge Function created a **draft** PO in Zoho. Procurement checks it and issues it there. |
| `failed` | Zoho refused it. The reason is in `error`. |
| `void_requested` / `voided` | Raghav undid the approval after a draft existed. The function deletes the draft in Zoho. |

POs are always drafts. Raghav's approval alone never issues an order or commits money.

## Going live (not done yet)

1. **Map your SKUs.** In Table Editor > `zoho_map`, fill `zoho_item_id` and `zoho_vendor_id` for each SKU (the Zoho item and the vendor that supplies it). `rate` is optional. A PO with a missing ID is flagged in the app and never sent.
2. **Create Zoho API access** at api-console.zoho.com (a Self Client is simplest) with scope `ZohoInventory.purchaseorders.CREATE,ZohoInventory.purchaseorders.DELETE,ZohoInventory.purchaseorders.READ`. Generate a refresh token. Find your organization ID in Zoho Inventory > Settings > Organization Profile.
3. **Store the secrets** in Supabase: Edge Functions > Secrets (never in this repo):
   `ZOHO_ACCOUNTS_URL`, `ZOHO_API_URL`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID`.
   Use the region that matches your Zoho account (for India: `https://accounts.zoho.in` and `https://www.zohoapis.in/inventory/v1`).
4. **Deploy** `functions/create-po` (Supabase CLI: `supabase functions deploy create-po --no-verify-jwt`).
5. **Trigger it:** Database > Webhooks > create a webhook on `purchase_orders` for INSERT and UPDATE that calls the function.
6. **Test with one SKU first**, check the draft in Zoho, then undo the approval and confirm the draft disappears.

The function has not been run against a real Zoho account. Treat the first live run as a test.
