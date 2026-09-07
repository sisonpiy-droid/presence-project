# Deploying Presence

Two options. **Vercel** deploys from GitHub and redeploys on every push --
use this if the repo is already connected. **Netlify** drag-and-drop is
below, unchanged, and still works.

---

# Option A: Vercel (from GitHub)

## 1. Import the repo

At https://vercel.com/new, import `presence-project`. Leave the build
settings alone -- `vercel.json` already sets the framework and output
directory, and there is no build step to configure.

## 2. Add your keys

**Settings -> Environment Variables.** Pick one provider.

**Anthropic:**

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your key from https://console.anthropic.com |
| `ANTHROPIC_MODEL` | a current ID from https://docs.claude.com |
| `PRESENCE_PASSCODE` | any word, e.g. `crossword` |

**Or Google Gemini** (free tier):

| Name | Value |
|---|---|
| `GEMINI_API_KEY` | free key from https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | a current ID from https://ai.google.dev/gemini-api/docs/models |
| `PRESENCE_PASSCODE` | any word, e.g. `crossword` |

Apply each to **Production, Preview and Development**. Set only one
provider's key and it picks that one; if you set both, add `LLM_PROVIDER`
as `anthropic` or `gemini`.

## 3. Redeploy

Environment variables only apply to builds that start *after* you add them.
**Deployments -> the latest one -> Redeploy.** Adding a variable does not
redeploy on its own, and this is the single most common reason the app
still says it has no API key.

## 4. Check it

Visit `https://<your-site>.vercel.app`. Enter the passcode when asked.

To test the function on its own:

```
curl -X POST https://<your-site>.vercel.app/api/chat   -H "content-type: application/json"   -H "x-presence-key: YOUR_PASSCODE"   -d '{"ping":true}'
```

`{"ok":true,"provider":"anthropic"}` means everything is wired up. A ping
costs nothing -- it never calls the model.

---

# Option B: Drag this folder onto Netlify

No terminal needed. Four steps, about five minutes.

## 1. Drop it

Go to **https://app.netlify.com/drop** and drag this whole folder onto the page. Not the files inside it — the folder itself, so `netlify.toml` and the `netlify` folder go up with it.

You'll get a live URL straight away, something like `random-name-123.netlify.app`.

## 2. Claim the site

Netlify will show a "Claim this site" or "Sign up to keep it" prompt. Do it — sign in with GitHub, Google or email. An unclaimed site expires and, more importantly, you can't set the API key without an account.

## 3. Add your keys

In the site dashboard: **Site configuration -> Environment variables -> Add a variable**.

Pick **one** provider.

**Anthropic:**

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your key from https://console.anthropic.com |
| `ANTHROPIC_MODEL` | a current ID from https://docs.claude.com |
| `PRESENCE_PASSCODE` | any word, e.g. `crossword` |

**Or Google Gemini** (has a free tier):

| Name | Value |
|---|---|
| `GEMINI_API_KEY` | free key from https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | a current ID from https://ai.google.dev/gemini-api/docs/models |
| `PRESENCE_PASSCODE` | any word, e.g. `crossword` |

Set only one provider's key and it picks that one automatically. If you set both, add `LLM_PROVIDER` as either `anthropic` or `gemini`.

<details><summary>old table</summary>

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your key from https://console.anthropic.com |
| `PRESENCE_PASSCODE` | any word, e.g. `crossword` |
| `ANTHROPIC_MODEL` | a current model ID from https://docs.claude.com |

</details>

`PRESENCE_PASSCODE` is not optional once you share the link. Without it, anyone who finds the URL can send requests that your API key pays for, and public endpoints get found by automated scanners within days.

## 4. Redeploy

Environment variables only take effect on a new deploy. In **Deploys**, use **Trigger deploy -> Deploy site**. Or just drag the folder onto the site again.

Then send your tester the URL and the passcode. They type it once and it's remembered on their device.

---

## If something's wrong

The app will tell you which problem it is, in plain language:

- **"This site has no API key set"** — step 3 didn't take, or you skipped step 4. Environment variables need a fresh deploy.
- **Vercel: every chat request 404s** — the deploy predates `api/chat.js`. Redeploy from the latest commit on `main`.
- **"The server function isn't responding"** — the `netlify` folder didn't upload. This happens if you dragged the *contents* rather than the folder. Try again with the folder itself.
- **"What is the passcode?"** but you don't know it — whoever deployed it set `PRESENCE_PASSCODE`. It's in your Netlify environment variables.

If drag-and-drop won't run the function at all, the reliable fallback is one command from the `presence-deploy` folder:

```
npx netlify deploy --prod
```

That uploads the site and the function together and is not fussy about folder structure.

---

## What your tester gets

Their own private copy. Conversations are stored in their browser, so they can't see anyone else's and **you can't see theirs**. Fine for "have a look at this." Not enough for the real ten-user test, where reading transcripts is the whole point — that needs Supabase behind it, and it needs telling people you're reading.
