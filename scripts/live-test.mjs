/* Real end-to-end check against the actual provider. Unlike smoke-test.mjs
   this DOES call the API and DOES cost a fraction of a cent.

   Run:  npm run test:live      (reads .env, which is gitignored)

   Never prints the key. Only its length and first few characters, which is
   enough to spot a truncated paste without putting the secret in a log. */

import { handleChat, pickProvider } from "../lib/chat-core.js";

const mask = (v) => (v ? `${v.slice(0, 6)}…${v.slice(-4)} (${v.length} chars)` : "(not set)");

console.log("Environment");
console.log(`  ANTHROPIC_API_KEY  ${mask(process.env.ANTHROPIC_API_KEY)}`);
console.log(`  GEMINI_API_KEY     ${mask(process.env.GEMINI_API_KEY)}`);
console.log(`  GEMINI_MODEL       ${process.env.GEMINI_MODEL || "(default: gemini-2.0-flash)"}`);
console.log(`  LLM_PROVIDER       ${process.env.LLM_PROVIDER || "(auto)"}`);
console.log(`  PRESENCE_PASSCODE  ${process.env.PRESENCE_PASSCODE ? "set" : "(not set)"}`);

const provider = pickProvider();
console.log(`\nResolved provider: ${provider ?? "NONE"}`);
if (!provider) {
  console.error("\nNo API key found. Add GEMINI_API_KEY to .env (uncomment the line too).");
  process.exit(1);
}

const headers = {};
if (process.env.PRESENCE_PASSCODE) headers["x-presence-key"] = process.env.PRESENCE_PASSCODE;
const getHeader = (n) => headers[n.toLowerCase()] ?? null;

let failed = 0;

// 1. Ping — proves key + provider resolve without spending anything.
console.log("\n1. Ping (no model call, no cost)");
{
  const r = await handleChat({ method: "POST", getHeader, readJson: async () => ({ ping: true }) });
  if (r.status === 200) console.log(`   PASS  provider=${r.body.provider}`);
  else { console.log(`   FAIL  ${r.status} ${JSON.stringify(r.body)}`); failed++; }
}

// 2. A real message — proves the key is valid and the model ID exists.
console.log("\n2. Real message to the model");
{
  const r = await handleChat({
    method: "POST",
    getHeader,
    readJson: async () => ({
      system: "Reply with exactly one short sentence.",
      messages: [{ role: "user", content: "Say hello and name which model you are." }],
      max_tokens: 100,
    }),
  });
  if (r.status === 200 && r.body.content?.[0]?.text) {
    console.log(`   PASS  model replied:`);
    console.log(`         "${r.body.content[0].text.trim()}"`);
  } else {
    console.log(`   FAIL  ${r.status} ${JSON.stringify(r.body)}`);
    failed++;
  }
}

// 3. Multi-turn — the frontend always sends history; make sure the shape
//    survives the Gemini role rename (assistant -> model).
console.log("\n3. Multi-turn history");
{
  const r = await handleChat({
    method: "POST",
    getHeader,
    readJson: async () => ({
      messages: [
        { role: "user", content: "My favourite colour is teal." },
        { role: "assistant", content: "Noted — teal it is." },
        { role: "user", content: "What is my favourite colour? One word." },
      ],
      max_tokens: 50,
    }),
  });
  const text = r.body?.content?.[0]?.text || "";
  if (r.status === 200 && /teal/i.test(text)) console.log(`   PASS  recalled context: "${text.trim()}"`);
  else if (r.status === 200) { console.log(`   FAIL  replied but lost context: "${text.trim()}"`); failed++; }
  else { console.log(`   FAIL  ${r.status} ${JSON.stringify(r.body)}`); failed++; }
}

// 4. Passcode enforcement, only meaningful once one is set.
console.log("\n4. Passcode enforcement");
if (!process.env.PRESENCE_PASSCODE) {
  console.log("   SKIP  PRESENCE_PASSCODE is empty — the endpoint is currently OPEN.");
  console.log("         Set it before sharing any URL, or anyone who finds it spends your credit.");
} else {
  const r = await handleChat({
    method: "POST",
    getHeader: (n) => (n.toLowerCase() === "x-presence-key" ? "definitely-wrong" : null),
    readJson: async () => ({ ping: true }),
  });
  if (r.status === 401) console.log("   PASS  wrong passcode rejected");
  else { console.log(`   FAIL  expected 401, got ${r.status}`); failed++; }
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed — safe to put this key in Vercel.");
process.exit(failed ? 1 : 0);
