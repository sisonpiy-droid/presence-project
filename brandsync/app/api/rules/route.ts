import { NextResponse } from "next/server";
import { db, embed } from "@/lib/server";

export async function POST(req: Request) {
  const { title, content } = await req.json().catch(() => ({}));
  if (!title?.trim() || !content?.trim()) return NextResponse.json({ error: "title and content required" }, { status: 400 });
  try {
    const embedding = await embed(`${title}\n${content}`, "RETRIEVAL_DOCUMENT");
    const { data, error } = await db
      .from("brand_rules")
      .insert({ title: title.trim(), content: content.trim(), embedding })
      .select("id,title,content")
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function GET() {
  const { data, error } = await db.from("brand_rules").select("id,title,content").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await db.from("brand_rules").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
