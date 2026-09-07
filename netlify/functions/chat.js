/* Netlify Function (v2) — holds the model API key server-side.
   config.path maps this to /api/chat, which is what the app calls.

   Works with Anthropic or Google Gemini. Whichever key you set in the
   environment is the one it uses. If both are set, LLM_PROVIDER decides.

   Env vars:
     ANTHROPIC_API_KEY / ANTHROPIC_MODEL
     GEMINI_API_KEY    / GEMINI_MODEL
     LLM_PROVIDER      "anthropic" | "gemini"  (only needed if both keys set)
     PRESENCE_PASSCODE a word your testers type once
     RATE_PER_HOUR     default 120 */

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

const PER_HOUR = Number(process.env.RATE_PER_HOUR || 120);
const seen = new Map();

function overLimit(ip) {
  const now = Date.now();
  const rec = seen.get(ip);
  if (!rec || now > rec.resetAt) { seen.set(ip, { n: 1, resetAt: now + 3600000 }); return false; }
  rec.n += 1;
  if (seen.size > 5000) seen.clear();
  return rec.n > PER_HOUR;
}

function pickProvider() {
  const forced = (process.env.LLM_PROVIDER || "").toLowerCase();
  if (forced === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (forced === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return null;
}

/* --- Anthropic --------------------------------------------------------- */
async function callAnthropic({ system, messages, max_tokens }) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
      max_tokens,
      system,
      messages,
    }),
  });
  const data = await r.json();
  if (!r.ok) return { ok: false, status: r.status, detail: data?.error?.message || "no detail given" };
  return { ok: true, content: data.content };
}

/* --- Gemini ------------------------------------------------------------
   Different shape entirely: the system prompt is its own field, the
   assistant role is called "model", and text comes back under
   candidates[].content.parts[]. Normalised to Anthropic's shape on the
   way out so the frontend never needs to know which one answered. */
async function callGemini({ system, messages, max_tokens }) {
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;

  const body = {
    contents: messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof m.content === "string" ? m.content : String(m.content) }],
    })),
    generationConfig: { maxOutputTokens: max_tokens, temperature: 1 },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) return { ok: false, status: r.status, detail: data?.error?.message || "no detail given" };

  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!text) {
    const why = cand?.finishReason === "SAFETY"
      ? "Gemini blocked the reply on safety grounds."
      : `Gemini returned nothing (finishReason: ${cand?.finishReason || "unknown"}).`;
    return { ok: false, status: 502, detail: why };
  }
  return { ok: true, content: [{ type: "text", text }] };
}

/* ----------------------------------------------------------------------- */
export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const provider = pickProvider();
  if (!provider) return json({ error: "no_key" }, 503);

  const required = process.env.PRESENCE_PASSCODE;
  if (required && req.headers.get("x-presence-key") !== required) return json({ error: "passcode" }, 401);

  const ip = (req.headers.get("x-nf-client-connection-ip") || "unknown").trim();
  if (overLimit(ip)) return json({ error: "rate" }, 429);

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: "bad json" }, 400); }

  // A ping only asks "would you accept me?" — it must not spend money.
  if (body && body.ping) return json({ ok: true, provider });

  const { messages, system, max_tokens } = body || {};
  if (!Array.isArray(messages) || !messages.length) return json({ error: "messages required" }, 400);

  const args = { system, messages, max_tokens: Math.min(Number(max_tokens) || 700, 1400) };

  try {
    const out = provider === "gemini" ? await callGemini(args) : await callAnthropic(args);
    if (!out.ok) {
      console.error(provider, out.status, out.detail);
      // Always 502 here. Passing the provider's status through made a bad
      // model ID look like a missing function, and a bad key look like a
      // bad passcode.
      return json({ error: "upstream", status: out.status, detail: `[${provider}] ${out.detail}` }, 502);
    }
    return json({ content: out.content });
  } catch (e) {
    console.error(e);
    return json({ error: "proxy failed" }, 500);
  }
};

export const config = { path: "/api/chat" };
