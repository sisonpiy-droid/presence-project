-- BrandSync schema. Run in the Supabase SQL editor.
create extension if not exists vector;

create table brand_rules (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  content    text not null,
  embedding  vector(768) not null,   -- gemini-embedding-001 @ 768 dims
  created_at timestamptz not null default now()
);
create index brand_rules_embedding_idx on brand_rules using hnsw (embedding vector_cosine_ops);

create type draft_status as enum ('pending', 'approved', 'rejected');

create table content_drafts (
  id          uuid primary key default gen_random_uuid(),
  body        text not null,
  has_image   boolean not null default false,
  analysis    jsonb,                                  -- Gemini compliance JSON
  status      draft_status not null default 'pending',
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz
);

-- Top-k most similar rules (cosine similarity).
create function match_brand_rules(query_embedding vector(768), match_count int default 6)
returns table (id uuid, title text, content text, similarity float)
language sql stable as $$
  select id, title, content, 1 - (embedding <=> query_embedding) as similarity
  from brand_rules
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- All access goes through server routes using the service-role key.
-- ponytail: RLS on with no policies = locked to the client. Add Auth + per-role policies for real multi-user.
alter table brand_rules    enable row level security;
alter table content_drafts enable row level security;
