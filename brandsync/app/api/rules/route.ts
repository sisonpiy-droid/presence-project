import { NextResponse } from "next/server";
import { db, embed } from "@/lib/server";

const MAX_IMAGE = 1024 * 1024;

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const title = String(form?.get("title") ?? "").trim();
  const content = String(form?.get("content") ?? "").trim();
  const image = form?.get("image");
  if (!title || !content) return NextResponse.json({ error: "title and content required" }, { status: 400 });

  let image_b64: string | null = null;
  let image_mime: string | null = null;
  if (image instanceof File && image.size > 0) {
    if (!image.type.startsWith("image/") || image.size > MAX_IMAGE)
      return NextResponse.json({ error: "reference image must be an image under 1MB" }, { status: 400 });
    image_b64 = Buffer.from(await image.arrayBuffer()).toString("base64");
    image_mime = image.type;
  }

  try {
    const embedding = await embed(`${title}\n${content}`, "RETRIEVAL_DOCUMENT");
    const { data, error } = await db
      .from("brand_rules")
      .insert({ title, content, embedding, image_b64, image_mime })
      .select("id,title,content,image_mime")
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function GET() {
  const { data, error } = await db.from("brand_rules").select("id,title,content,image_mime").order("created_at", { ascending: false });
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
