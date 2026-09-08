# Security notes

What the backend does, what it deliberately does not do, and what is still
weak. Read the last section before a real test with real people.

## The API key

- Held server-side only. The browser never sees it; it calls `/api/chat` and
  the function talks to the provider.
- Sent to Gemini as an `x-goog-api-key` **header**, not a URL query parameter.
  Keys in URLs are written to access logs, retained by proxies, and quoted
  back inside error messages.
- `redact()` strips the configured keys, and anything key-shaped
  (`AIza…`, `sk-ant-…`, `key=…`), out of every provider error before it
  reaches the client or the logs.
- `.env` is gitignored and has never been committed.

## Access

- `PRESENCE_PASSCODE` is **required**. With it unset the function returns
  `503 no_passcode` and refuses every request. It previously defaulted to
  open, which meant a forgotten environment variable published an endpoint
  that spent real money. `ALLOW_NO_PASSCODE=1` is the deliberate override.
- The passcode is compared with `timingSafeEqual` over SHA-256 digests, so
  neither its length nor its content leaks through response timing.
- An empty `x-presence-key` header does not pass.

## Request bounds

Output is uncapped so replies are not truncated, which makes **input** the
thing that bounds what a request costs. Every field below arrives from the
client and is checked before the provider is called:

| Limit | Default | Env var |
|---|---|---|
| Total characters across messages | 120000 | `MAX_INPUT_CHARS` |
| Number of messages | 200 | `MAX_MESSAGES` |
| System prompt characters | 20000 | `MAX_SYSTEM_CHARS` |
| Upstream deadline | 60s | `UPSTREAM_TIMEOUT_MS` |

Message `role` must be `user` or `assistant` and `content` must be a string.
Oversized requests return `413` and never reach the provider.

## Rate limiting

`RATE_PER_HOUR` (default 120) per IP, read from `x-forwarded-for` on Vercel
and `x-nf-client-connection-ip` on Netlify.

When the tracking map fills, entries are evicted **lowest request-count
first**, and a caller currently over the limit is never evicted. Evicting by
age let a flood of fresh IPs push out the exact offender the limiter existed
to hold; the earlier code called `.clear()` and handed everyone a fresh
allowance at once.

## Browser-facing headers

Set in `vercel.json`: `Content-Security-Policy` (no inline scripts, no
framing, `connect-src 'self'`), `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy: no-referrer`, `Permissions-Policy` denying camera,
microphone and geolocation, and HSTS. `/api/*` is `no-store`.

## Known weaknesses

**The rate limit is per instance, not global.** The counter lives in the
memory of one warm serverless instance. Vercel runs many and recycles them,
so the real ceiling is `RATE_PER_HOUR × instances`, and a cold start resets
it. It slows a casual burst; it is not a quota. A real one needs shared
storage (Vercel KV, Upstash).

**The client chooses the system prompt.** The app sends `system` with every
request, so anyone holding the passcode can make the model do something other
than be Presence — the endpoint is a general-purpose LLM to them. Fixing this
means moving prompt construction server-side, which the built bundle cannot
do without a rebuild. Bounded by `MAX_SYSTEM_CHARS`, not prevented.

**The passcode is shared, not per-user.** One word for everybody, stored in
`localStorage`. Anyone who has it can pass it on, and revoking means changing
it for all testers at once.

**Conversations are stored unencrypted in the browser.** Anyone with the
device can read them. Nothing is sent anywhere except the model provider.

**No audit trail.** Nothing records who sent what. Deliberate for privacy,
but it means abuse is invisible beyond provider-side usage graphs.
