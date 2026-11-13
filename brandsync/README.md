# BrandSync

Brand governance for marketing teams. Paste a draft (and optionally an image); BrandSync checks it against your approved brand guide **before** it goes live, cites the exact rule it breaks, and suggests the smallest fix. A manager approves or rejects.

## How it works (multimodal RAG)

1. **Ingest** — each brand rule is embedded (`gemini-embedding-001`, 768-d) and stored in Supabase `pgvector`.
2. **Retrieve** — the draft is embedded and the 6 nearest rules come back from `match_brand_rules()` (cosine similarity, HNSW index). Only relevant rules reach the model, so the guide can grow without bloating the prompt.
3. **Reason** — Gemini receives the rules + draft text + image and returns schema-constrained JSON: severity, exact excerpt, cited `rule_id`, suggested edit.
4. **Guard** — citations of rules we never retrieved are dropped, so the model can't invent policy. A 0–100 brand score is computed server-side from severities.
5. **Review** — violations are highlighted inline, fixes apply with one click (non-destructive: nothing changes until you press Apply), and approval is blocked until an edited draft is re-checked. Every check lands in the manager queue.

## Run it

```bash
cp .env.example .env.local   # fill in the three keys
# run supabase/schema.sql in the Supabase SQL editor
npm install
npm run dev
```

Open http://localhost:3000 and click **Load sample brand guide**, then try:

> Get our CHEAPEST deals now!!! Our miracle serum is clinically proven to cure acne, unlike Brand X.

## Stack

Next.js (App Router) · Tailwind v4 · Supabase (Postgres + pgvector) · Gemini API

## Known gaps

No authentication yet (all routes use the service-role key server-side; RLS blocks direct client access). Images are analysed but not stored.
