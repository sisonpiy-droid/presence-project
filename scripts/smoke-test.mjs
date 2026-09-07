/* Exercises both entry points against a stubbed upstream. No real API key,
   no network, no spend. Run: npm run test:function */

import assert from "node:assert";

const results = [];
function check(name, fn) { results.push([name, fn]); }

// --- stub the model provider so nothing leaves the machine ---------------
let lastRequest = null;
globalThis.fetch = async (url, opts) => {
  lastRequest = { url: String(url), opts };
  // Each provider has its own response shape; returning Anthropic's to both
  // made the Gemini path look broken when it was only the stub that was.
  const gemini = String(url).includes("generativelanguage.googleapis.com");
  return {
    ok: true,
    status: 200,
    json: async () => (gemini
      ? { candidates: [{ content: { parts: [{ text: "stubbed reply" }] }, finishReason: "STOP" }] }
      : { content: [{ type: "text", text: "stubbed reply" }] }),
  };
};

function resetEnv(env = {}) {
  for (const k of ["ANTHROPIC_API_KEY","GEMINI_API_KEY","ANTHROPIC_MODEL","GEMINI_MODEL","LLM_PROVIDER","PRESENCE_PASSCODE","RATE_PER_HOUR","MAX_TOKENS_CAP"]) {
    delete process.env[k];
  }
  Object.assign(process.env, env);
}

// --- adapters -------------------------------------------------------------
async function callVercel({ method = "POST", headers = {}, body }) {
  const { default: handler } = await import("../api/chat.js");
  const req = { method, headers, body };
  let status, payload, sentHeaders = {};
  const res = {
    status(s) { status = s; return res; },
    setHeader(k, v) { sentHeaders[k] = v; return res; },
    end(str) { payload = JSON.parse(str); },
  };
  await handler(req, res);
  return { status, body: payload, headers: sentHeaders };
}

async function callNetlify({ method = "POST", headers = {}, body }) {
  const { default: handler } = await import("../netlify/functions/chat.js");
  const req = new Request("https://example.test/api/chat", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  const res = await handler(req);
  return { status: res.status, body: await res.json() };
}

const both = { vercel: callVercel, netlify: callNetlify };

// --- tests ----------------------------------------------------------------
for (const [name, call] of Object.entries(both)) {
  check(`${name}: GET is rejected`, async () => {
    resetEnv({ ANTHROPIC_API_KEY: "k" });
    const r = await call({ method: "GET" });
    assert.equal(r.status, 405);
  });

  check(`${name}: no key configured -> 503 no_key`, async () => {
    resetEnv({});
    const r = await call({ body: { ping: true } });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "no_key");
  });

  check(`${name}: wrong passcode -> 401`, async () => {
    resetEnv({ ANTHROPIC_API_KEY: "k", PRESENCE_PASSCODE: "crossword" });
    const r = await call({ headers: { "x-presence-key": "nope" }, body: { ping: true } });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "passcode");
  });

  check(`${name}: correct passcode + ping -> provider, no spend`, async () => {
    resetEnv({ ANTHROPIC_API_KEY: "k", PRESENCE_PASSCODE: "crossword" });
    lastRequest = null;
    const r = await call({ headers: { "x-presence-key": "crossword" }, body: { ping: true } });
    assert.equal(r.status, 200);
    assert.equal(r.body.provider, "anthropic");
    assert.equal(lastRequest, null, "ping must not call the provider");
  });

  check(`${name}: empty messages -> 400`, async () => {
    resetEnv({ ANTHROPIC_API_KEY: "k" });
    const r = await call({ body: { messages: [] } });
    assert.equal(r.status, 400);
  });

  check(`${name}: real message reaches Anthropic and returns content`, async () => {
    resetEnv({ ANTHROPIC_API_KEY: "k" });
    const r = await call({ body: { messages: [{ role: "user", content: "hi" }] } });
    assert.equal(r.status, 200);
    assert.equal(r.body.content[0].text, "stubbed reply");
    assert.match(lastRequest.url, /api\.anthropic\.com/);
    assert.equal(lastRequest.opts.headers["x-api-key"], "k");
  });

  check(`${name}: GEMINI_API_KEY alone routes to Gemini`, async () => {
    resetEnv({ GEMINI_API_KEY: "gk" });
    const r = await call({ body: { messages: [{ role: "user", content: "hi" }] } });
    assert.equal(r.status, 200);
    assert.match(lastRequest.url, /generativelanguage\.googleapis\.com/);
    // Gemini's shape must be normalised to Anthropic's before it reaches
    // the frontend, which only knows how to read content[].text.
    assert.equal(r.body.content[0].text, "stubbed reply");
    assert.equal(r.body.content[0].type, "text");
  });

  check(`${name}: the client's max_tokens is ignored by default`, async () => {
    resetEnv({ ANTHROPIC_API_KEY: "k" });
    // The built frontend hardcodes 450-850 per register and cannot be
    // rebuilt, so honouring its number is what truncated replies.
    await call({ body: { messages: [{ role: "user", content: "hi" }], max_tokens: 450 } });
    assert.equal(JSON.parse(lastRequest.opts.body).max_tokens, 8192,
      "should fall back to ANTHROPIC_DEFAULT_MAX, not the client's 450");
  });
}

check("Gemini sends no maxOutputTokens when uncapped", async () => {
  resetEnv({ GEMINI_API_KEY: "gk" });
  await callVercel({ body: { messages: [{ role: "user", content: "hi" }], max_tokens: 450 } });
  const cfg = JSON.parse(lastRequest.opts.body).generationConfig;
  // Omitting it lets the model run to its own 65536 limit and stop when the
  // thought is finished, instead of being cut off mid-sentence.
  assert.ok(!("maxOutputTokens" in cfg), "maxOutputTokens must be absent when uncapped");
});

check("MAX_TOKENS_CAP re-imposes a ceiling, with thinking headroom", async () => {
  resetEnv({ GEMINI_API_KEY: "gk", MAX_TOKENS_CAP: "1000" });
  await callVercel({ body: { messages: [{ role: "user", content: "hi" }], max_tokens: 450 } });
  assert.equal(JSON.parse(lastRequest.opts.body).generationConfig.maxOutputTokens, 1600,
    "1000 cap + 600 headroom");
});

check("MAX_TOKENS_CAP applies to Anthropic without headroom", async () => {
  resetEnv({ ANTHROPIC_API_KEY: "k", MAX_TOKENS_CAP: "1000" });
  await callVercel({ body: { messages: [{ role: "user", content: "hi" }] } });
  assert.equal(JSON.parse(lastRequest.opts.body).max_tokens, 1000);
});

check("default Gemini model is not the retired gemini-2.0-flash", async () => {
  resetEnv({ GEMINI_API_KEY: "gk" });
  await callVercel({ body: { messages: [{ role: "user", content: "hi" }] } });
  assert.ok(!lastRequest.url.includes("gemini-2.0-flash"),
    "gemini-2.0-flash was retired by Google and 404s");
  assert.match(lastRequest.url, /gemini-3\.6-flash/);
});

check("a stale Anthropic key beats Gemini unless LLM_PROVIDER pins it", async () => {
  const { pickProvider } = await import("../lib/chat-core.js");
  // Documents why setup:vercel always sends LLM_PROVIDER. This is the real
  // precedence, not the desired one -- if it ever changes, the deploy script
  // needs revisiting.
  resetEnv({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "sk-ant-stale" });
  assert.equal(pickProvider(), "anthropic", "Anthropic is checked first");

  resetEnv({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "sk-ant-stale", LLM_PROVIDER: "gemini" });
  assert.equal(pickProvider(), "gemini", "LLM_PROVIDER must override the stale key");
});

check("an empty ANTHROPIC_API_KEY does not hijack the provider", async () => {
  const { pickProvider } = await import("../lib/chat-core.js");
  resetEnv({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "", ANTHROPIC_MODEL: "claude-sonnet-5" });
  assert.equal(pickProvider(), "gemini");
});

// --- the bug this port was meant to fix -----------------------------------
check("clientIp reads x-forwarded-for (Vercel), not just the Netlify header", async () => {
  const { clientIp } = await import("../lib/chat-core.js");
  const vercelHeaders = { "x-forwarded-for": "203.0.113.9, 70.41.3.18" };
  assert.equal(clientIp((n) => vercelHeaders[n] ?? null), "203.0.113.9",
    "must take the first hop from x-forwarded-for");
  const netlifyHeaders = { "x-nf-client-connection-ip": "198.51.100.4" };
  assert.equal(clientIp((n) => netlifyHeaders[n] ?? null), "198.51.100.4",
    "Netlify must keep working");
  assert.equal(clientIp(() => null), "unknown");
});

check("rate limiter separates two IPs", async () => {
  resetEnv({ ANTHROPIC_API_KEY: "k", RATE_PER_HOUR: "120" });
  const { overLimit } = await import("../lib/chat-core.js");
  for (let i = 0; i < 130; i++) overLimit("1.1.1.1");
  assert.equal(overLimit("1.1.1.1"), true, "hammered IP should be limited");
  assert.equal(overLimit("2.2.2.2"), false, "a different IP must not be");
});

// --- run ------------------------------------------------------------------
let pass = 0, fail = 0;
for (const [name, fn] of results) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
