import { NextResponse } from "next/server";
import { db, embed, generateJson } from "@/lib/server";

export const maxDuration = 60;

const MAX_IMAGE = 4 * 1024 * 1024;
const PENALTY = { high: 30, medium: 15, low: 5 } as const;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    violations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          rule_id: { type: "STRING", description: "id of the violated rule, copied exactly" },
          severity: { type: "STRING", enum: ["high", "medium", "low"] },
          excerpt: { type: "STRING", description: "exact offending substring of the draft, or 'IMAGE' if the issue is visual" },
          issue: { type: "STRING" },
          suggested_edit: { type: "STRING", description: "replacement for the excerpt that fixes the issue while keeping the intent; for IMAGE, say what to change" },
        },
        required: ["rule_id", "severity", "excerpt", "issue", "suggested_edit"],
      },
    },
  },
  required: ["summary", "violations"],
};

type Rule = { id: string; title: string; content: string; similarity: number };

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const text = String(form.get("text") ?? "").trim();
    const image = form.get("image");
    if (!text) return NextResponse.json({ error: "draft text required" }, { status: 400 });

    const parts: unknown[] = [];
    let hasImage = false;
    if (image instanceof File && image.size > 0) {
      if (!image.type.startsWith("image/") || image.size > MAX_IMAGE)
        return NextResponse.json({ error: "image must be an image under 4MB" }, { status: 400 });
      parts.push({ inlineData: { mimeType: image.type, data: Buffer.from(await image.arrayBuffer()).toString("base64") } });
      hasImage = true;
    }

    // Retrieve: embed the draft, pull the nearest rules.
    const { data, error } = await db.rpc("match_brand_rules", {
      query_embedding: await embed(text, "RETRIEVAL_QUERY"),
      match_count: 6,
    });
    if (error) throw error;
    const rules = (data ?? []) as Rule[];
    if (!rules.length) return NextResponse.json({ error: "No brand rules yet — add some first." }, { status: 400 });

    // Generate: rules + draft (+ image) -> structured verdict.
    parts.push({
      text: `You are a strict but fair brand-compliance reviewer. Check the draft${hasImage ? " and the attached image" : ""} ONLY against the rules below. Do not invent rules and do not flag things no rule covers. Cite each violation by rule_id. Quote the offending excerpt exactly as written. Suggest the smallest edit that fixes it. If nothing is violated, return an empty violations array.

RULES:
${rules.map((r) => `[id: ${r.id}] ${r.title}: ${r.content}`).join("\n")}

DRAFT:
"""${text}"""`,
    });
    const out = await generateJson(parts, SCHEMA);

    // Attach the real rule text; drop citations of rules we never supplied.
    const byId = new Map(rules.map((r) => [r.id, r]));
    out.violations = (out.violations as { rule_id: string; severity: keyof typeof PENALTY }[])
      .filter((v) => byId.has(v.rule_id))
      .map((v) => ({ ...v, rule_title: byId.get(v.rule_id)!.title, rule_text: byId.get(v.rule_id)!.content }));
    out.compliant = out.violations.length === 0;
    out.score = Math.max(0, 100 - out.violations.reduce((n: number, v: { severity: keyof typeof PENALTY }) => n + (PENALTY[v.severity] ?? 10), 0));
    out.consulted = rules.map((r) => ({ id: r.id, title: r.title, similarity: Math.round(r.similarity * 100) }));

    const { data: draft, error: e2 } = await db
      .from("content_drafts")
      .insert({ body: text, has_image: hasImage, analysis: out })
      .select("id")
      .single();
    if (e2) throw e2;
    return NextResponse.json({ draftId: draft.id, analysis: out });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
