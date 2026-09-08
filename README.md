# Presence

A static React app with a serverless function that proxies **Anthropic** or
**Google Gemini**, so the model API key stays on the server and never reaches
the browser.

Deploys to **Vercel** or **Netlify** from the same repo.

## Layout

```
index.html              entry page; loads the built bundle
assets/index-*.js       the built React bundle Vercel/Netlify serve directly
presence-app.jsx        React source (see "Known gap" below)

lib/chat-core.js        all the real logic, platform-agnostic
api/chat.js             Vercel entry point   -> /api/chat
netlify/functions/chat.js  Netlify entry point -> /api/chat

vercel.json             Vercel: SPA rewrite, output dir
netlify.toml            Netlify: SPA rewrite, functions dir
scripts/smoke-test.mjs  tests both entry points, no network, no spend
```

The two entry points are thin adapters. Vercel's Node runtime passes
`(req, res)`; Netlify Functions v2 pass a Web `Request` and want a `Response`.
Both hand off to `handleChat()` immediately, so there is one copy of the logic.

## Environment variables

Set these in your host's dashboard, never in the repo. See `.env.example`.

| Name | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | one provider | from console.anthropic.com |
| `ANTHROPIC_MODEL` | no | default `claude-sonnet-5` |
| `GEMINI_API_KEY` | one provider | free tier at aistudio.google.com/apikey |
| `GEMINI_MODEL` | no | default `gemini-3.6-flash` |
| `LLM_PROVIDER` | only if both keys set | `anthropic` or `gemini` |
| `PRESENCE_PASSCODE` | **yes, in practice** | testers type it once |
| `RATE_PER_HOUR` | no | default 120 |
| `GEMINI_THINKING_HEADROOM` | no | default 600, only used when `MAX_TOKENS_CAP` is set |
| `MAX_TOKENS_CAP` | no | unset = no output limit, see below |
| `ANTHROPIC_MAX_TOKENS` | no | default 8192; Anthropic requires a number |

Set one provider's key and it picks that provider automatically.

`PRESENCE_PASSCODE` is not optional once you share the link. Without it,
anyone who finds the URL sends requests your key pays for, and public
endpoints get found by scanners within days.

## Testing

```
npm run check          syntax-check every entry point
npm run test:function  21 assertions, stubbed provider, no network, no spend
npm run test:live      real calls to the real provider, reads .env, costs a little
npm run setup:vercel   push .env vars to Vercel and redeploy
```

`test:function` needs no API key. `test:live` reads the gitignored `.env` and
checks four things end to end: the key resolves, a real message comes back,
multi-turn history survives, and a wrong passcode is rejected.

## Gemini model IDs go stale

Google retires model IDs. `gemini-2.0-flash` now returns **404**, and a dead
model ID and a bad key produce almost identical-looking failures. If Gemini
suddenly stops working, check this first:

```
npm run test:live
```

To see what your key can actually reach, list the models rather than guessing
at a name from documentation.

## Output length is uncapped by default

The built frontend hardcodes a token budget per register (`texts` 450,
`letter` 850) chosen for Anthropic, which spends none of them thinking.
Gemini 3.x spends 800-1000 on a letter-length prompt before writing a word,
so those budgets truncated replies mid-sentence.

Since the bundle cannot be rebuilt from this repo, the client's `max_tokens`
is **ignored**. Gemini requests omit `maxOutputTokens` entirely and the model
stops when it has finished, up to its own 65536 limit. Measured on
`gemini-3.6-flash` with the letter register:

| maxOutputTokens | finishReason | reply |
|---|---|---|
| 850 (register value) | `MAX_TOKENS` | 30 tokens, cut off |
| 850 + 600 headroom | `MAX_TOKENS` | 450 tokens, cut off |
| omitted | `STOP` | 735 tokens, complete |

Register *style* still works, because each register's system prompt describes
its own length ("Short, several messages in a row").

Set `MAX_TOKENS_CAP` to a number to re-impose a ceiling; it then gets
`GEMINI_THINKING_HEADROOM` added on Gemini. Note that uncapped output costs
more per reply -- on Gemini's free tier this is bounded by the tier itself,
but on a paid key a long conversation is billed for what it generates.

## Gemini spends tokens thinking

Gemini 3.x reasons before writing, and `maxOutputTokens` caps thinking *and*
reply together. Measured ~300-400 thinking tokens on a short prompt, so
passing a 700-token budget straight through left only ~55 for the visible
reply. `thinkingConfig.thinkingBudget: 0` is not a workaround --
`gemini-3.6-flash` rejects it with a 400 and `gemini-3.8-flash` ignores it.

So `callGemini` adds `GEMINI_THINKING_HEADROOM` (default 600) on top of the
caller's budget. Anthropic is unaffected. If replies start arriving truncated,
raise it.

## Known gap: the bundle and the source are not connected

`index.html` loads `assets/index-*.js`, a **prebuilt** bundle.
`presence-app.jsx` is the source it was built from — but there is no bundler
config in this repo, so **editing the `.jsx` does not change the deployed
site**. The bundle is the artifact that ships.

To change the app you need a build step (Vite) wired up, with the `.jsx`
moved into `src/` and the host set to build on push. Until then, treat
`presence-app.jsx` as a reference copy that can drift from what users see.

## Rate limiting is per-instance

`lib/chat-core.js` keeps its counter in memory. Serverless runs many
instances and recycles them, so this blunts a burst from one IP against one
warm instance — it is not a real quota. Anything load-bearing needs shared
storage (Vercel KV, Upstash).

## Security

See [SECURITY.md](SECURITY.md) for what the backend protects against, and
the known weaknesses to read before testing with real people.
