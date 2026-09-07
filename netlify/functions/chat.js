/* Netlify entry point. Netlify Functions v2 speak the Web standard
   Request/Response, and config.path below is what maps this to /api/chat.

   Kept so the existing Netlify deploy keeps working. The actual logic
   lives in lib/chat-core.js, shared with the Vercel entry point. */

import { handleChat } from "../../lib/chat-core.js";

export default async (req) => {
  const { status, body } = await handleChat({
    method: req.method,
    getHeader: (name) => req.headers.get(name),
    readJson: () => req.json(),
  });

  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};

export const config = { path: "/api/chat" };
