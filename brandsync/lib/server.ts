import { createClient } from "@supabase/supabase-js";

// Supabase's gateway occasionally answers 401 "JWT issued at future" (clock skew between its nodes). It clears on retry.
const retryFetch: typeof fetch = async (input, init) => {
  for (let i = 0; ; i++) {
    const r = await fetch(input, init);
    if (r.status !== 401 || i >= 3 || !(await r.clone().text()).includes("JWT")) return r;
    await new Promise((res) => setTimeout(res, 700));
  }
};

export const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false }, global: { fetch: retryFetch } },
);

const G = "https://generativelanguage.googleapis.com/v1beta/models";

async function gemini(model: string, method: string, body: unknown) {
  let r: Response;
  for (let attempt = 0; ; attempt++) {
    r = await fetch(`${G}/${model}:${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
      body: JSON.stringify(body),
    });
    // Retry rate limits / overload twice with backoff; demos shouldn't die on one blip.
    if (![429, 500, 503].includes(r.status) || attempt >= 2) break;
    await new Promise((res) => setTimeout(res, 800 * 2 ** attempt));
  }
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
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.2, thinkingConfig: { thinkingLevel: "low" } }, // low thinking: ~4x faster, plenty for rule-matching
    
  });
  return JSON.parse(j.candidates[0].content.parts[0].text);
}
