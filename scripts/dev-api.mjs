/* Local stand-in for the deployed function, so the whole app can be exercised
   on this machine: real prompts, real provider, real error codes.

   Run:  npm run dev:api      (reads .env, same as production would)
   Then: npm run dev          (Vite proxies /api here)

   This is a development tool. It is not what runs in production -- that is
   api/chat.js on Vercel and netlify/functions/chat.js on Netlify, both of
   which are thin adapters over the same lib/chat-core.js this uses. */

import { createServer } from "node:http";
import { handleChat } from "../lib/chat-core.js";

const PORT = Number(process.env.DEV_API_PORT || 3000);

createServer(async (req, res) => {
  if (!req.url.startsWith("/api/chat")) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "not found" }));
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");

  const { status, body } = await handleChat({
    method: req.method,
    getHeader: (n) => req.headers[n.toLowerCase()] ?? null,
    readJson: () => JSON.parse(raw),
  });

  console.log(`${req.method} /api/chat -> ${status}`);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}).listen(PORT, () => {
  console.log(`dev api on http://localhost:${PORT}  (provider picked from .env)`);
});
