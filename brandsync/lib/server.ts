import { createClient } from "@supabase/supabase-js";

export const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const G = "https://generativelanguage.googleapis.com/v1beta/models";

async function gemini(model: string, method: string, body: unknown) {
  const r = await fetch(`${G}/${model}:${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

export async function embed(text: string, kind: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY") {
  const j = await gemini("gemini-embedding-001", "embedContent", {
    content: { parts: [{ text }] },
    taskType: kind,
    outputDimensionality: 768,
  });
  return j.embedding.values as number[];
}

export async function generateJson(parts: unknown[], schema: unknown) {
  const j = await gemini(process.env.GEMINI_MODEL ?? "gemini-3.6-flash", "generateContent", {
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.2 },
  });
  return JSON.parse(j.candidates[0].content.parts[0].text);
}
