/* Shared chat logic. Platform-agnostic on purpose: it takes plain values
   in and returns a plain { status, body } out, so the Vercel and Netlify
   entry points are thin adapters over the same code rather than two
   copies that quietly drift apart.

   Env vars:
     ANTHROPIC_API_KEY / ANTHROPIC_MODEL
     GEMINI_API_KEY    / GEMINI_MODEL
     LLM_PROVIDER      "anthropic" | "gemini"  (only needed if both keys set)
     PRESENCE_PASSCODE a word your testers type once
     RATE_PER_HOUR     default 120 */

const PER_HOUR = Number(process.env.RATE_PER_HOUR || 120);

/* Per-instance only. Serverless runs many instances and recycles them, so
   this throttles a burst from one IP against one warm instance -- it is not
   a real quota. Anything load-bearing needs shared storage (Upstash, KV). */
const seen = new Map();

export function overLimit(ip) {
  const now = Date.now();
  const rec = seen.get(ip);
  if (!rec || now > rec.resetAt) { seen.set(ip, { n: 1, resetAt: now + 3600000 }); return false; }
  rec.n += 1;
  if (seen.size > 5000) seen.clear();
  return rec.n > PER_HOUR;
}

export function pickProvider() {
  const forced = (process.env.LLM_PROVIDER || "").toLowerCase();
  if (forced === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (forced === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return null;
}

/* Netlify sets x-nf-client-connection-ip; Vercel sets x-forwarded-for.
   Reading only the Netlify one on Vercel gave every caller the IP
   "unknown", which silently collapsed all users into a single bucket. */
export function clientIp(getHeader) {
  const fwd = getHeader("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return (getHeader("x-real-ip") || getHeader("x-nf-client-connection-ip") || "unknown").trim();
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

/* -----------------------------------------------------------------------
   handleChat({ method, getHeader, readJson })
     method   -- "POST" etc
     getHeader(name) -> string | null   (name is always lowercase)
     readJson()      -> parsed body, may throw on bad JSON
   Returns { status, body } -- never throws. */
export async function handleChat({ method, getHeader, readJson }) {
  if (method !== "POST") return { status: 405, body: { error: "POST only" } };

  const provider = pickProvider();
  if (!provider) return { status: 503, body: { error: "no_key" } };

  const required = process.env.PRESENCE_PASSCODE;
  if (required && getHeader("x-presence-key") !== required) {
    return { status: 401, body: { error: "passcode" } };
  }

  if (overLimit(clientIp(getHeader))) return { status: 429, body: { error: "rate" } };

  let body;
  try { body = await readJson(); } catch { return { status: 400, body: { error: "bad json" } }; }

  // A ping only asks "would you accept me?" -- it must not spend money.
  if (body && body.ping) return { status: 200, body: { ok: true, provider } };

  const { messages, system, max_tokens } = body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return { status: 400, body: { error: "messages required" } };
  }

  const args = { system, messages, max_tokens: Math.min(Number(max_tokens) || 700, 1400) };

  try {
    const out = provider === "gemini" ? await callGemini(args) : await callAnthropic(args);
    if (!out.ok) {
      console.error(provider, out.status, out.detail);
      // Always 502 here. Passing the provider's status through made a bad
      // model ID look like a missing function, and a bad key look like a
      // bad passcode.
      return { status: 502, body: { error: "upstream", status: out.status, detail: `[${provider}] ${out.detail}` } };
    }
    return { status: 200, body: { content: out.content } };
  } catch (e) {
    console.error(e);
    return { status: 500, body: { error: "proxy failed" } };
  }
}
