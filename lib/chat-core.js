/* Shared chat logic. Platform-agnostic on purpose: it takes plain values
   in and returns a plain { status, body } out, so the Vercel and Netlify
   entry points are thin adapters over the same code rather than two
   copies that quietly drift apart.

   Env vars:
     ANTHROPIC_API_KEY / ANTHROPIC_MODEL
     GEMINI_API_KEY    / GEMINI_MODEL
     LLM_PROVIDER      "anthropic" | "gemini"  (only needed if both keys set)
     PRESENCE_PASSCODE a word your testers type once. REQUIRED: without it
                       the endpoint refuses to serve, unless ALLOW_NO_PASSCODE=1
     RATE_PER_HOUR     default 120
     MAX_INPUT_CHARS / MAX_MESSAGES / MAX_SYSTEM_CHARS   input bounds
     UPSTREAM_TIMEOUT_MS  default 60000 */

import { createHash, timingSafeEqual } from "node:crypto";

/* Read per call rather than at import. Module-level constants are captured
   once, which makes the settings below impossible to exercise in tests -- and
   an untested setting is how the truncation bug survived this long. */
const envNum = (name, fallback) => Number(process.env[name] || fallback);

const perHour = () => envNum("RATE_PER_HOUR", 120);

/* --- input limits -------------------------------------------------------
   The output cap was deliberately removed so replies are not truncated,
   which makes the INPUT the only thing bounding what a request can cost.
   Without these, one caller holding the passcode could post a megabyte of
   context and bill it to this key. Gemini accepts a 1,048,576-token input. */
const maxInputChars  = () => envNum("MAX_INPUT_CHARS", 120000);
const maxMessages    = () => envNum("MAX_MESSAGES", 200);
const maxSystemChars = () => envNum("MAX_SYSTEM_CHARS", 20000);

/* Upstream calls need a deadline. Without one a hung provider holds the
   function open until the platform kills it, and the caller learns nothing. */
const upstreamTimeoutMs = () => envNum("UPSTREAM_TIMEOUT_MS", 60000);

/* Compare secrets without leaking length or content through timing.
   Hashing first keeps both inputs the same length, so timingSafeEqual does
   not throw on a mismatched-length guess (which is itself a signal). */
function secretsMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/* Provider error text is passed back to the client so the app can show a
   useful diagnostic. Strip anything key-shaped first: Google historically
   echoes the request URL in some errors, and the key used to live in it. */
export function redact(text) {
  let out = String(text ?? "");
  for (const name of ["GEMINI_API_KEY", "ANTHROPIC_API_KEY"]) {
    const v = process.env[name];
    if (v && v.length > 8) out = out.split(v).join("<redacted>");
  }
  return out
    .replace(/AIza[A-Za-z0-9_\-]{10,}/g, "<redacted>")
    .replace(/sk-ant-[A-Za-z0-9_\-]{10,}/g, "<redacted>")
    .replace(/(key|api[_-]?key|token)=[^&\s"']+/gi, "$1=<redacted>");
}

/* Extra Gemini-only token budget to cover reasoning tokens (see callGemini). */
const thinkingHeadroom = () => envNum("GEMINI_THINKING_HEADROOM", 600);

/* Output length.

   The built frontend hardcodes a small budget per register (texts 450,
   letter 850) and sends it as max_tokens. Those numbers were chosen for
   Anthropic, which spends none of them thinking. Gemini 3.x spends 300-400
   before it writes anything, so a 450-token "texts" reply had ~50 left and
   longer registers were cut off mid-sentence.

   The bundle cannot be rebuilt from this repo, so the client's number cannot
   be fixed at source. We ignore it instead and let the model stop when it is
   finished. Register style is still enforced -- each one's system prompt
   describes its own length ("Short, several messages in a row").

   Set MAX_TOKENS_CAP to a number to re-impose a ceiling. 0 or unset means no
   server-imposed cap. */
const maxTokensCap = () => envNum("MAX_TOKENS_CAP", 0);

/* Anthropic requires max_tokens on every request, so "uncapped" still needs
   a number there. Gemini simply omits the field. */
const anthropicDefaultMax = () => envNum("ANTHROPIC_MAX_TOKENS", 8192);

/* Per-instance only. Serverless runs many instances and recycles them, so
   this throttles a burst from one IP against one warm instance -- it is not
   a real quota. Anything load-bearing needs shared storage (Upstash, KV). */
const seen = new Map();

const MAX_TRACKED = 5000;

export function overLimit(ip) {
  const now = Date.now();

  /* Evict expired entries rather than wiping the map. The old code called
     seen.clear() once it passed 5000, which meant anyone could reset every
     other visitor's counter -- and their own -- just by sending traffic from
     enough distinct addresses. That turned the limiter into a formality. */
  if (seen.size >= MAX_TRACKED) {
    for (const [k, v] of seen) if (now > v.resetAt) seen.delete(k);
    if (seen.size >= MAX_TRACKED) {
      /* Still full of live entries. Evict the LOWEST counts first, so the
         callers already over the limit are the last to be forgotten.
         Evicting by age instead let a flood of fresh IPs push out exactly
         the offender the limiter existed to hold, which is the shape of the
         attack rather than an edge case. */
      const byCount = [...seen.entries()].sort((a, b) => a[1].n - b[1].n);
      const excess = seen.size - MAX_TRACKED + 1;
      for (let i = 0; i < excess && i < byCount.length; i++) {
        if (byCount[i][1].n > perHour()) break; // never evict a live offender
        seen.delete(byCount[i][0]);
      }
    }
  }

  const rec = seen.get(ip);
  if (!rec || now > rec.resetAt) { seen.set(ip, { n: 1, resetAt: now + 3600000 }); return false; }
  rec.n += 1;
  return rec.n > perHour();
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
    signal: AbortSignal.timeout(upstreamTimeoutMs()),
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
      max_tokens: max_tokens || anthropicDefaultMax(),
      system,
      messages,
    }),
  });
  const data = await r.json();
  if (!r.ok) return { ok: false, status: r.status, detail: redact(data?.error?.message || "no detail given") };
  return { ok: true, content: data.content };
}

/* --- Gemini ------------------------------------------------------------
   Different shape entirely: the system prompt is its own field, the
   assistant role is called "model", and text comes back under
   candidates[].content.parts[]. Normalised to Anthropic's shape on the
   way out so the frontend never needs to know which one answered. */
async function callGemini({ system, messages, max_tokens }) {
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  /* The key goes in a header, not the query string. A key in a URL is
     written to access logs, kept in proxy caches, and shows up in error text
     that quotes the request -- none of which a header does. */
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const body = {
    contents: messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof m.content === "string" ? m.content : String(m.content) }],
    })),
    // Omitting maxOutputTokens lets the model run to its own limit (65536 on
    // gemini-3.6-flash) and stop when it has finished the thought, which is
    // the point of not capping. When a cap IS set, it still needs headroom:
    // maxOutputTokens counts thinking and reply together, and thinkingConfig
    // .thinkingBudget:0 is not a fix -- 3.6-flash rejects it with a 400 and
    // 3.8-flash ignores it.
    generationConfig: {
      temperature: 1,
      ...(max_tokens ? { maxOutputTokens: max_tokens + thinkingHeadroom() } : {}),
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const r = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(upstreamTimeoutMs()),
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) return { ok: false, status: r.status, detail: redact(data?.error?.message || "no detail given") };

  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!text) {
    const reason = cand?.finishReason || "unknown";
    const why = reason === "SAFETY"
      ? "Gemini blocked the reply on safety grounds."
      : reason === "MAX_TOKENS"
        ? "Gemini used its whole budget thinking and never wrote a reply. Raise or unset MAX_TOKENS_CAP."
        : `Gemini returned nothing (finishReason: ${reason}).`;
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

  /* Fail closed. An unset passcode used to mean "let everyone in", so a
     forgotten variable silently published an endpoint that spends real money
     -- and public endpoints get found by scanners within days. Refusing is
     the safe default; ALLOW_NO_PASSCODE=1 is the deliberate opt-out. */
  const required = process.env.PRESENCE_PASSCODE;
  if (!required) {
    if (process.env.ALLOW_NO_PASSCODE !== "1") {
      console.error("PRESENCE_PASSCODE is not set; refusing to serve. Set it, or set ALLOW_NO_PASSCODE=1 to accept the risk.");
      return { status: 503, body: { error: "no_passcode" } };
    }
  } else if (!secretsMatch(getHeader("x-presence-key") || "", required)) {
    return { status: 401, body: { error: "passcode" } };
  }

  if (overLimit(clientIp(getHeader))) return { status: 429, body: { error: "rate" } };

  let body;
  try { body = await readJson(); } catch { return { status: 400, body: { error: "bad json" } }; }

  // A ping only asks "would you accept me?" -- it must not spend money.
  if (body && body.ping) return { status: 200, body: { ok: true, provider } };

  const { messages, system } = body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return { status: 400, body: { error: "messages required" } };
  }

  /* Bound the input. With no output cap, input size is what decides the cost
     of a request, and every field here arrives from the client. */
  if (messages.length > maxMessages()) {
    return { status: 413, body: { error: "too_many_messages", limit: maxMessages() } };
  }
  if (typeof system === "string" && system.length > maxSystemChars()) {
    return { status: 413, body: { error: "system_too_long", limit: maxSystemChars() } };
  }
  let total = 0;
  for (const m of messages) {
    if (!m || typeof m !== "object") {
      return { status: 400, body: { error: "bad message" } };
    }
    if (m.role !== "user" && m.role !== "assistant") {
      return { status: 400, body: { error: "bad role" } };
    }
    if (typeof m.content !== "string") {
      return { status: 400, body: { error: "content must be a string" } };
    }
    total += m.content.length;
  }
  if (total > maxInputChars()) {
    return { status: 413, body: { error: "input_too_long", limit: maxInputChars() } };
  }

  // The client's max_tokens is deliberately ignored unless MAX_TOKENS_CAP is
  // set -- see the note by MAX_TOKENS_CAP. null means "let the model finish".
  const cap = maxTokensCap();
  const args = { system, messages, max_tokens: cap > 0 ? cap : null };

  try {
    const out = provider === "gemini" ? await callGemini(args) : await callAnthropic(args);
    if (!out.ok) {
      console.error(provider, out.status, redact(out.detail));
      // Always 502 here. Passing the provider's status through made a bad
      // model ID look like a missing function, and a bad key look like a
      // bad passcode.
      return { status: 502, body: { error: "upstream", status: out.status, detail: `[${provider}] ${out.detail}` } };
    }
    return { status: 200, body: { content: out.content } };
  } catch (e) {
    console.error(redact(e?.stack || e?.message || String(e)));
    // TimeoutError is what AbortSignal.timeout throws; say so rather than
    // reporting a generic failure the caller cannot act on.
    const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
    return timedOut
      ? { status: 504, body: { error: "upstream_timeout" } }
      : { status: 500, body: { error: "proxy failed" } };
  }
}
