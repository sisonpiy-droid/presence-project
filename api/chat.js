/* Vercel entry point. File location IS the route: api/chat.js -> /api/chat.
   No path config, unlike Netlify.

   Vercel's Node runtime hands you (req, res) in Node style, so this adapts
   to the platform-neutral core in lib/chat-core.js. */

import { handleChat } from "../lib/chat-core.js";

// Vercel usually pre-parses a JSON body onto req.body, but not always --
// it depends on the content-type the client sent. Fall back to reading the
// stream so a missing or odd content-type doesn't turn into a false
// "bad json" for the caller.
async function readBody(req) {
  if (req.body !== undefined && req.body !== null && req.body !== "") {
    if (typeof req.body === "string") return JSON.parse(req.body);
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) throw new Error("empty body");
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  const { status, body } = await handleChat({
    method: req.method,
    // Node lowercases incoming header names already; normalise anyway so
    // the core can rely on it.
    getHeader: (name) => req.headers[name.toLowerCase()] ?? null,
    readJson: () => readBody(req),
  });

  res.status(status).setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
