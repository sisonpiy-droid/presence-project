"use client";
import { useEffect, useMemo, useState } from "react";
import { SAMPLE_RULES } from "@/lib/sample-rules";

type Violation = { rule_id: string; rule_title: string; rule_text: string; severity: "high" | "medium" | "low"; excerpt: string; issue: string; suggested_edit: string };
type Analysis = { compliant: boolean; score: number; summary: string; violations: Violation[]; consulted: { id: string; title: string; similarity: number }[] };
type Rule = { id: string; title: string; content: string };
type Draft = { id: string; body: string; status: "pending" | "approved" | "rejected"; analysis: Analysis; created_at: string };

const input = "w-full rounded-lg border border-neutral-300 bg-white p-3 text-sm focus:outline-2 focus:outline-indigo-500";
const btn = "rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50";
const SEV = { high: "bg-red-100 text-red-900", medium: "bg-amber-100 text-amber-900", low: "bg-sky-100 text-sky-900" };
const STATUS = { pending: "bg-neutral-100 text-neutral-700", approved: "bg-green-100 text-green-900", rejected: "bg-red-100 text-red-900" };

async function api(url: string, init: RequestInit = {}) {
  const r = await fetch(url, init);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Request failed");
  return j;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// Split text into plain / flagged segments for inline annotation.
function annotate(text: string, vs: Violation[]) {
  const ranges = vs
    .map((v) => ({ i: text.indexOf(v.excerpt), len: v.excerpt.length, v }))
    .filter((r) => r.i >= 0 && r.len > 0)
    .sort((a, b) => a.i - b.i);
  const out: { t: string; v?: Violation }[] = [];
  let at = 0;
  for (const r of ranges) {
    if (r.i < at) continue; // overlapping; skip
    if (r.i > at) out.push({ t: text.slice(at, r.i) });
    out.push({ t: text.slice(r.i, r.i + r.len), v: r.v });
    at = r.i + r.len;
  }
  if (at < text.length) out.push({ t: text.slice(at) });
  return out;
}

export default function Dashboard() {
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [draftId, setDraftId] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [checkedText, setCheckedText] = useState("");
  const [decision, setDecision] = useState("");
  const [ruleTitle, setRuleTitle] = useState("");
  const [ruleBody, setRuleBody] = useState("");
  const [rules, setRules] = useState<Rule[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [tab, setTab] = useState<"review" | "queue">("review");
  const preview = useMemo(() => (image ? URL.createObjectURL(image) : ""), [image]);

  const loadRules = () => api("/api/rules").then(setRules).catch((e) => setErr(e.message));
  const loadDrafts = () => api("/api/drafts").then(setDrafts).catch((e) => setErr(e.message));
  useEffect(() => { loadRules(); loadDrafts(); }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const check = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const fd = new FormData();
      fd.set("text", text);
      if (image) fd.set("image", image);
      const j = await api("/api/check-compliance", { method: "POST", body: fd });
      setDraftId(j.draftId); setAnalysis(j.analysis); setDecision(""); setCheckedText(text); setTab("review");
      loadDrafts();
    });
  };

  const decide = (status: "approved" | "rejected") =>
    run(async () => {
      await api(`/api/drafts/${draftId}`, json("PATCH", { status }));
      setDecision(status);
      loadDrafts();
    });

  const addRule = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api("/api/rules", json("POST", { title: ruleTitle, content: ruleBody }));
      setRuleTitle(""); setRuleBody("");
      await loadRules();
    });
  };

  const loadSamples = () =>
    run(async () => {
      for (const r of SAMPLE_RULES) await api("/api/rules", json("POST", r));
      await loadRules();
    });

  const delRule = (id: string) => run(async () => { await api(`/api/rules?id=${id}`, { method: "DELETE" }); await loadRules(); });

  const open = (d: Draft) => {
    setDraftId(d.id); setAnalysis(d.analysis); setText(d.body); setCheckedText(d.body);
    setDecision(d.status === "pending" ? "" : d.status); setTab("review");
  };

  const apply = (v: Violation) => setText((t) => t.replace(v.excerpt, v.suggested_edit));
  const applyAll = () => analysis && setText((t) => analysis.violations.reduce((s, v) => (v.excerpt === "IMAGE" ? s : s.replace(v.excerpt, v.suggested_edit)), t));
  const edited = analysis !== null && text !== checkedText;
  const segments = useMemo(() => (analysis ? annotate(checkedText, analysis.violations) : []), [analysis, checkedText]);
  const scoreColor = !analysis ? "" : analysis.score >= 80 ? "text-green-600" : analysis.score >= 50 ? "text-amber-600" : "text-red-600";

  return (
    <main className="grid min-h-screen md:grid-cols-2">
      {/* Left: submission */}
      <section className="space-y-8 border-b border-neutral-200 p-6 md:border-b-0 md:border-r md:p-10">
        <header>
          <h1 className="text-2xl font-semibold">BrandSync</h1>
          <p className="text-sm text-neutral-500">Check every draft against your brand guide before it goes live.</p>
        </header>

        <form onSubmit={check} className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="draft">Draft copy</label>
          <textarea id="draft" className={input} rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste your caption, ad copy, email…" required />
          {preview && <img src={preview} alt="Attached draft" className="max-h-40 rounded-lg border border-neutral-200" />}
          <input type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] ?? null)} className="block text-sm" aria-label="Optional image" />
          <button disabled={busy || !rules.length} className={`${btn} bg-indigo-600 text-white`}>{busy ? "Working…" : "Run compliance check"}</button>
          {!rules.length && <p className="text-sm text-neutral-500">Add at least one brand rule first.</p>}
        </form>

        <details className="rounded-lg border border-neutral-200 bg-white p-4" open={!rules.length}>
          <summary className="cursor-pointer text-sm font-medium">Brand rules ({rules.length})</summary>
          <ul className="mt-3 space-y-2 text-sm">
            {rules.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 rounded border border-neutral-200 p-2">
                <span><strong>{r.title}</strong> — {r.content}</span>
                <button type="button" disabled={busy} onClick={() => delRule(r.id)} className="text-red-700 hover:underline" aria-label={`Delete rule ${r.title}`}>Delete</button>
              </li>
            ))}
          </ul>
          <form onSubmit={addRule} className="mt-3 space-y-3">
            <input className={input} placeholder="Title (e.g. Tone of voice)" value={ruleTitle} onChange={(e) => setRuleTitle(e.target.value)} required />
            <textarea className={input} rows={3} placeholder="Rule text" value={ruleBody} onChange={(e) => setRuleBody(e.target.value)} required />
            <div className="flex gap-3">
              <button disabled={busy} className={`${btn} bg-neutral-900 text-white`}>Save rule</button>
              <button type="button" disabled={busy} onClick={loadSamples} className={`${btn} border border-neutral-300`}>Load sample brand guide</button>
            </div>
          </form>
        </details>
        {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      </section>

      {/* Right: review */}
      <section className="space-y-4 bg-white p-6 md:p-10">
        <div className="flex gap-2 text-sm" role="tablist">
          {(["review", "queue"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-full px-3 py-1 ${tab === t ? "bg-neutral-900 text-white" : "bg-neutral-100"}`}>
              {t === "review" ? "Review" : `Manager queue (${drafts.filter((d) => d.status === "pending").length})`}
            </button>
          ))}
        </div>

        {tab === "queue" ? (
          <ul className="space-y-2">
            {!drafts.length && <p className="text-neutral-400">No drafts yet.</p>}
            {drafts.map((d) => (
              <li key={d.id}>
                <button onClick={() => open(d)} className="w-full rounded-lg border border-neutral-200 p-3 text-left text-sm hover:bg-neutral-50">
                  <span className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1">{d.body}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS[d.status]}`}>{d.status}</span>
                  </span>
                  <span className="text-xs text-neutral-500">Score {d.analysis?.score ?? "–"} · {d.analysis?.violations?.length ?? 0} issue(s) · {new Date(d.created_at).toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : !analysis ? (
          <p className="text-neutral-400">Results appear here after you run a check.</p>
        ) : (
          <>
            <div className="flex items-center gap-4 rounded-lg bg-neutral-50 p-4">
              <div className={`text-4xl font-semibold tabular-nums ${scoreColor}`} aria-label={`Brand score ${analysis.score} out of 100`}>{analysis.score}</div>
              <p className="text-sm"><strong>{analysis.compliant ? "Compliant" : `${analysis.violations.length} issue(s) found`}</strong> — {analysis.summary}</p>
            </div>

            <div className="rounded-lg border border-neutral-200 p-3 text-sm leading-relaxed whitespace-pre-wrap">
              {segments.map((s, i) => s.v ? <mark key={i} className={`rounded px-0.5 ${SEV[s.v.severity]}`}>{s.t}</mark> : <span key={i}>{s.t}</span>)}
            </div>

            {analysis.violations.map((v, i) => (
              <article key={i} className="space-y-2 rounded-lg border border-neutral-200 p-4 text-sm">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  <span className={`rounded-full px-2 py-0.5 ${SEV[v.severity]}`}>{v.severity}</span> Rule: {v.rule_title}
                </p>
                <p className="text-neutral-600">“{v.rule_text}”</p>
                <p>{v.issue}</p>
                <p><span className="font-medium">Suggested: </span><span className="rounded bg-green-100 px-1 text-green-900">{v.suggested_edit}</span></p>
                <button type="button" disabled={!text.includes(v.excerpt)} onClick={() => apply(v)} className="text-indigo-700 hover:underline disabled:text-neutral-400 disabled:no-underline">
                  {text.includes(v.excerpt) ? "Apply to draft" : "Applied / not in text"}
                </button>
              </article>
            ))}
            {analysis.violations.length > 1 && <button onClick={applyAll} className="text-sm text-indigo-700 hover:underline">Apply all text fixes</button>}

            <details className="text-xs text-neutral-500">
              <summary className="cursor-pointer">Rules consulted by retrieval ({analysis.consulted?.length ?? 0})</summary>
              <ul className="mt-1 flex flex-wrap gap-1">
                {analysis.consulted?.map((c) => <li key={c.id} className="rounded-full bg-neutral-100 px-2 py-0.5">{c.title} · {c.similarity}%</li>)}
              </ul>
            </details>

            {edited && !decision && <p className="text-sm text-neutral-600">Draft edited — re-run the check before approving.</p>}
            {decision ? (
              <p className="font-medium">Marked {decision}.</p>
            ) : (
              <div className="flex gap-3">
                <button disabled={busy || edited} onClick={() => decide("approved")} className={`${btn} bg-green-600 text-white`}>Approve</button>
                <button disabled={busy} onClick={() => decide("rejected")} className={`${btn} bg-red-600 text-white`}>Reject</button>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
