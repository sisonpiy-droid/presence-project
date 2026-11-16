"use client";
import { useEffect, useMemo, useState } from "react";
import { SAMPLE_RULES } from "@/lib/sample-rules";

type Sev = "high" | "medium" | "low";
type Violation = { rule_id: string; rule_title: string; rule_text: string; severity: Sev; excerpt: string; issue: string; suggested_edit: string };
type Analysis = { compliant: boolean; score: number; summary: string; violations: Violation[]; consulted: { id: string; title: string; similarity: number }[] };
type Rule = { id: string; title: string; content: string; image_mime: string | null };
type Draft = { id: string; body: string; status: "pending" | "approved" | "rejected"; analysis: Analysis; created_at: string };
type Tab = "check" | "guide" | "queue";

const EXAMPLE = "Get our CHEAPEST deals now!!! Our miracle serum is clinically proven to cure acne, unlike Brand X.";
const STEPS = ["Embedding your draft", "Retrieving the most relevant brand rules", "Gemini is reviewing text and image"];
const SEV: Record<Sev, string> = { high: "bg-red-100 text-red-900", medium: "bg-amber-100 text-amber-900", low: "bg-sky-100 text-sky-900" };
const BORDER: Record<Sev, string> = { high: "border-l-red-500", medium: "border-l-amber-500", low: "border-l-sky-500" };
const STATUS = { pending: "bg-slate-100 text-slate-700", approved: "bg-green-100 text-green-900", rejected: "bg-red-100 text-red-900" };

const field = "w-full rounded-xl border border-slate-300 bg-white p-3 text-sm shadow-sm focus:outline-2 focus:outline-indigo-500";
const primary = "rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50";
const ghost = "rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50";

async function api(url: string, init: RequestInit = {}) {
  const r = await fetch(url, init);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Request failed");
  return j;
}

function postRule(r: { title: string; content: string }, image?: File | null) {
  const fd = new FormData();
  fd.set("title", r.title);
  fd.set("content", r.content);
  if (image) fd.set("image", image);
  return api("/api/rules", { method: "POST", body: fd });
}

// Split text into plain / flagged segments for inline annotation.
function annotate(text: string, vs: Violation[]) {
  const ranges = vs
    .map((v) => ({ i: text.indexOf(v.excerpt), len: v.excerpt.length, v }))
    .filter((r) => r.i >= 0 && r.len > 0)
    .sort((a, b) => a.i - b.i);
  const out: { t: string; v?: Violation }[] = [];
  let at = 0;
  for (const r of ranges) {
    if (r.i < at) continue;
    if (r.i > at) out.push({ t: text.slice(at, r.i) });
    out.push({ t: text.slice(r.i, r.i + r.len), v: r.v });
    at = r.i + r.len;
  }
  if (at < text.length) out.push({ t: text.slice(at) });
  return out;
}

function applyFixes(text: string, vs: Violation[]) {
  return vs
    .reduce((s, v) => (v.excerpt === "IMAGE" ? s : s.replace(v.excerpt, v.suggested_edit)), text)
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/[,;]\s*([.!?])/g, "$1")
    .replace(/\.{2,}/g, ".")
    .trim();
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? "text-green-600" : score >= 50 ? "text-amber-500" : "text-red-600";
  return (
    <div className={`relative h-24 w-24 shrink-0 ${color}`} role="img" aria-label={`Brand score ${score} out of 100`}>
      <svg viewBox="0 0 36 36" className="h-24 w-24 -rotate-90">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="3" />
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${score} 100`} className="transition-all duration-700" />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-2xl font-bold tabular-nums">{score}</span>
    </div>
  );
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("check");
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [checking, setChecking] = useState(false);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [draftId, setDraftId] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [checkedText, setCheckedText] = useState("");
  const [decision, setDecision] = useState("");
  const [rules, setRules] = useState<Rule[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [ruleTitle, setRuleTitle] = useState("");
  const [ruleBody, setRuleBody] = useState("");
  const [ruleImage, setRuleImage] = useState<File | null>(null);
  const [copied, setCopied] = useState(false);
  const preview = useMemo(() => (image ? URL.createObjectURL(image) : ""), [image]);

  const loadRules = () => api("/api/rules").then(setRules).catch((e) => setErr(e.message));
  const loadDrafts = () => api("/api/drafts").then(setDrafts).catch((e) => setErr(e.message));
  useEffect(() => { loadRules(); loadDrafts(); }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    if (!checking) return;
    setStep(0);
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2500);
    return () => clearInterval(t);
  }, [checking]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function check(t: string) {
    setChecking(true);
    setErr("");
    setTab("check");
    try {
      const fd = new FormData();
      fd.set("text", t);
      if (image) fd.set("image", image);
      const j = await api("/api/check-compliance", { method: "POST", body: fd });
      setDraftId(j.draftId); setAnalysis(j.analysis); setDecision(""); setCheckedText(t);
      loadDrafts();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  const loadSamples = async () => {
    await Promise.all(SAMPLE_RULES.map((r) => postRule(r)));
    await loadRules();
  };

  async function runDemo() {
    setErr("");
    setAnalysis(null);
    setText(EXAMPLE);
    setTab("check");
    try {
      if (!rules.length) { setChecking(true); await loadSamples(); }
    } catch (e) {
      setChecking(false);
      return setErr((e as Error).message);
    }
    await check(EXAMPLE);
  }

  const decide = (status: "approved" | "rejected") =>
    run(async () => {
      await api(`/api/drafts/${draftId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
      setDecision(status);
      loadDrafts();
    });

  const addRule = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await postRule({ title: ruleTitle, content: ruleBody }, ruleImage);
      setRuleTitle(""); setRuleBody(""); setRuleImage(null);
      await loadRules();
    });
  };

  const delRule = (id: string) => run(async () => { await api(`/api/rules?id=${id}`, { method: "DELETE" }); await loadRules(); });

  const open = (d: Draft) => {
    setDraftId(d.id); setAnalysis(d.analysis); setText(d.body); setCheckedText(d.body);
    setDecision(d.status === "pending" ? "" : d.status); setTab("check");
  };

  const fixed = useMemo(() => (analysis ? applyFixes(checkedText, analysis.violations) : ""), [analysis, checkedText]);
  const visualIssues = analysis?.violations.filter((v) => v.excerpt === "IMAGE").length ?? 0;
  const segments = useMemo(() => (analysis ? annotate(checkedText, analysis.violations) : []), [analysis, checkedText]);
  const edited = analysis !== null && text !== checkedText;
  const hasHigh = analysis?.violations.some((v) => v.severity === "high");
  const issuesCaught = drafts.reduce((n, d) => n + (d.analysis?.violations?.length ?? 0), 0);
  const avgScore = drafts.length ? Math.round(drafts.reduce((n, d) => n + (d.analysis?.score ?? 0), 0) / drafts.length) : "–";
  const pending = drafts.filter((d) => d.status === "pending").length;

  const copy = async () => {
    try { await navigator.clipboard.writeText(fixed); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  const tabs: [Tab, string][] = [["check", "Check a draft"], ["guide", `Brand guide (${rules.length})`], ["queue", `Manager queue${pending ? ` (${pending})` : ""}`]];

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50/70 via-white to-white">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 md:px-8">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 font-bold text-white" aria-hidden>B</span>
            <span className="text-lg font-semibold tracking-tight">BrandSync</span>
          </div>
          <nav className="flex flex-1 gap-1 overflow-x-auto text-sm" role="tablist" aria-label="Sections">
            {tabs.map(([t, label]) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 font-medium ${tab === t ? "bg-indigo-100 text-indigo-900" : "text-slate-600 hover:bg-slate-100"}`}>
                {label}
              </button>
            ))}
          </nav>
          <button onClick={runDemo} disabled={checking || busy} className={`${primary} hidden sm:block`}>▶ Run the demo</button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 md:px-8">
        {err && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{err}</p>}

        {/* ───────── CHECK ───────── */}
        {tab === "check" && (
          <div className="grid gap-8 lg:grid-cols-2">
            <section className="space-y-5">
              <div>
                <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Is your content on-brand?</h1>
                <p className="mt-2 text-slate-600">Paste a draft. BrandSync checks it against your brand guide, shows exactly which rule it breaks, and fixes it.</p>
              </div>

              {!rules.length && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <span>You haven’t added a brand guide yet.</span>
                  <button onClick={() => run(loadSamples)} disabled={busy} className="font-semibold underline">Load a sample guide</button>
                  <span>or</span>
                  <button onClick={() => setTab("guide")} className="font-semibold underline">add your own rules</button>
                </div>
              )}

              <form onSubmit={(e) => { e.preventDefault(); check(text); }} className="space-y-3">
                <label className="block text-sm font-semibold" htmlFor="draft">Your draft</label>
                <textarea id="draft" className={field} rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a caption, ad, email, or post…" required />
                {preview && <img src={preview} alt="Attached to the draft" className="max-h-44 rounded-xl border border-slate-200" />}
                <div className="flex flex-wrap items-center gap-3">
                  <button disabled={checking || !rules.length} className={primary}>{checking ? "Checking…" : "Check my draft"}</button>
                  <button type="button" onClick={() => setText(EXAMPLE)} className={ghost}>Use an example</button>
                  <label className={`${ghost} cursor-pointer`}>
                    {image ? "Change image" : "＋ Attach image"}
                    <input type="file" accept="image/*" className="sr-only" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
                  </label>
                  {image && <button type="button" onClick={() => setImage(null)} className="text-sm text-slate-500 underline">Remove</button>}
                </div>
              </form>
            </section>

            <section aria-live="polite" className="space-y-4">
              {checking ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <ol className="space-y-3 text-sm">
                    {STEPS.map((s, i) => (
                      <li key={s} className={`flex items-center gap-3 ${i > step ? "text-slate-400" : i < step ? "text-slate-500" : "font-semibold text-indigo-700"}`}>
                        <span className={`grid h-6 w-6 place-items-center rounded-full text-xs ${i < step ? "bg-green-100 text-green-800" : i === step ? "animate-pulse bg-indigo-100" : "bg-slate-100"}`}>{i < step ? "✓" : i + 1}</span>
                        {s}…
                      </li>
                    ))}
                  </ol>
                </div>
              ) : !analysis ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
                  <h2 className="text-lg font-semibold">How BrandSync works</h2>
                  <ol className="mt-4 space-y-4 text-sm">
                    {[
                      ["Teach it your brand", "Add rules in plain English — even with a reference image for visual standards."],
                      ["Check any draft", "It finds the rules that matter for this draft and reviews your text and image against them."],
                      ["Fix and approve", "See the exact problem, the rule it breaks, and a ready-to-use fix. A manager signs off."],
                    ].map(([h, d], i) => (
                      <li key={h} className="flex gap-3">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-indigo-600 text-xs font-bold text-white">{i + 1}</span>
                        <p><strong className="block">{h}</strong><span className="text-slate-600">{d}</span></p>
                      </li>
                    ))}
                  </ol>
                  <button onClick={runDemo} disabled={busy} className={`${primary} mt-6 w-full`}>▶ See it in 20 seconds</button>
                  <p className="mt-3 text-center text-xs text-slate-500">Loads a sample brand guide and checks a risky post — one click.</p>
                </div>
              ) : (
                <>
                  <div className={`rounded-2xl border p-5 ${analysis.compliant ? "border-green-200 bg-green-50" : hasHigh ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
                    <div className="flex items-center gap-5">
                      <ScoreRing score={analysis.score} />
                      <div>
                        <p className="text-xl font-bold">{analysis.compliant ? "On brand — ready to publish" : hasHigh ? "Not ready to publish" : "Needs a few edits"}</p>
                        <p className="mt-1 text-sm text-slate-700">{analysis.summary}</p>
                      </div>
                    </div>
                  </div>

                  {!analysis.compliant && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-relaxed whitespace-pre-wrap shadow-sm">
                      {segments.map((s, i) => s.v ? <mark key={i} className={`rounded px-0.5 ${SEV[s.v.severity]}`}>{s.t}</mark> : <span key={i}>{s.t}</span>)}
                    </div>
                  )}

                  {analysis.violations.map((v, i) => (
                    <article key={i} className={`space-y-1.5 rounded-xl border border-l-4 border-slate-200 bg-white p-4 text-sm shadow-sm ${BORDER[v.severity]}`}>
                      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <span className={`rounded-full px-2 py-0.5 ${SEV[v.severity]}`}>{v.severity}</span> Breaks: {v.rule_title}
                      </p>
                      <p className="font-medium">{v.issue}</p>
                      <p className="text-slate-500">Rule: “{v.rule_text}”</p>
                      <p><span className="font-medium">Fix: </span><span className="rounded bg-green-100 px-1 text-green-900">{v.suggested_edit || "(remove)"}</span></p>
                    </article>
                  ))}

                  {!analysis.compliant && fixed && fixed !== checkedText && (
                    <div className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
                      <p className="text-sm font-semibold text-indigo-900">Fixed version</p>
                      <p className="rounded-xl bg-white p-3 text-sm whitespace-pre-wrap">{fixed}</p>
                      {visualIssues > 0 && <p className="text-xs text-indigo-900">{visualIssues} visual issue(s) can’t be auto-fixed — swap the image.</p>}
                      <div className="flex gap-3">
                        <button onClick={() => { setText(fixed); check(fixed); }} disabled={checking} className={primary}>Use it &amp; re-check</button>
                        <button onClick={copy} className={ghost}>{copied ? "Copied ✓" : "Copy"}</button>
                      </div>
                    </div>
                  )}

                  <details className="text-xs text-slate-500">
                    <summary className="cursor-pointer">Rules the AI consulted ({analysis.consulted?.length ?? 0})</summary>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {analysis.consulted?.map((c) => <li key={c.id} className="rounded-full bg-slate-100 px-2.5 py-1">{c.title} · {c.similarity}% match</li>)}
                    </ul>
                  </details>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-sm font-semibold">Manager decision</p>
                    {decision ? (
                      <p className="mt-2 text-sm">This draft is <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[decision as "approved" | "rejected"]}`}>{decision}</span>.</p>
                    ) : (
                      <>
                        {edited && <p className="mt-1 text-xs text-slate-500">You edited the draft — check it again before approving.</p>}
                        <div className="mt-3 flex gap-3">
                          <button disabled={busy || edited} onClick={() => decide("approved")} className="rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">Approve</button>
                          <button disabled={busy} onClick={() => decide("rejected")} className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">Reject</button>
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        )}

        {/* ───────── BRAND GUIDE ───────── */}
        {tab === "guide" && (
          <div className="grid gap-8 lg:grid-cols-2">
            <section className="space-y-4">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">Your brand guide</h1>
                <p className="mt-2 text-slate-600">Write rules the way you’d tell a new hire. Each one is turned into a vector embedding so the AI can find the right rules for every draft.</p>
              </div>
              <form onSubmit={addRule} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <input className={field} placeholder="Rule name (e.g. Tone of voice)" value={ruleTitle} onChange={(e) => setRuleTitle(e.target.value)} required />
                <textarea className={field} rows={3} placeholder="What’s allowed, what’s not…" value={ruleBody} onChange={(e) => setRuleBody(e.target.value)} required />
                <label className="block text-sm text-slate-600">
                  Reference image <span className="text-slate-400">(optional — logo, palette, do/don’t; under 1MB)</span>
                  <input type="file" accept="image/*" onChange={(e) => setRuleImage(e.target.files?.[0] ?? null)} className="mt-1 block text-sm" />
                </label>
                <div className="flex flex-wrap gap-3">
                  <button disabled={busy} className={primary}>{busy ? "Saving…" : "Add rule"}</button>
                  <button type="button" disabled={busy} onClick={() => run(loadSamples)} className={ghost}>Load sample guide</button>
                </div>
              </form>
            </section>
            <section>
              <ul className="space-y-3">
                {!rules.length && <li className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No rules yet. Add one, or load the sample guide.</li>}
                {rules.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
                    <div>
                      <p className="font-semibold">{r.title}{r.image_mime && <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-900">+ image</span>}</p>
                      <p className="mt-1 text-slate-600">{r.content}</p>
                    </div>
                    <button disabled={busy} onClick={() => delRule(r.id)} className="shrink-0 text-red-700 hover:underline" aria-label={`Delete rule ${r.title}`}>Delete</button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}

        {/* ───────── QUEUE ───────── */}
        {tab === "queue" && (
          <section className="mx-auto max-w-3xl space-y-5">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Manager queue</h1>
              <p className="mt-2 text-slate-600">Every checked draft lands here. Open one to review and approve or reject.</p>
            </div>
            <dl className="grid grid-cols-3 gap-3 text-center">
              {[["Drafts checked", drafts.length], ["Issues caught", issuesCaught], ["Avg brand score", avgScore]].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <dd className="text-3xl font-bold tabular-nums">{v}</dd>
                  <dt className="text-xs text-slate-500">{k}</dt>
                </div>
              ))}
            </dl>
            <ul className="space-y-2">
              {!drafts.length && <li className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Nothing here yet — run a check first.</li>}
              {drafts.map((d) => (
                <li key={d.id}>
                  <button onClick={() => open(d)} className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left text-sm shadow-sm hover:bg-slate-50">
                    <span className="flex items-center justify-between gap-3">
                      <span className="line-clamp-1 font-medium">{d.body}</span>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS[d.status]}`}>{d.status}</span>
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">Score {d.analysis?.score ?? "–"} · {d.analysis?.violations?.length ?? 0} issue(s) · {new Date(d.created_at).toLocaleString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-8 text-center text-xs text-slate-400 md:px-8">
        Rules are embedded into Supabase pgvector · relevant ones are retrieved per draft · Gemini reviews text and images against them.
      </footer>
    </div>
  );
}
