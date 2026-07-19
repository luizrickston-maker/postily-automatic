-- Posts agendados (estado controlado pelo scheduler)
DO $$ BEGIN
  CREATE TYPE post_state AS ENUM ('DRAFT','QUEUE','PUBLISHING','PUBLISHED','ERROR','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  group_id UUID,                                  -- mesmo group_id = combo multi-plataforma
  state post_state NOT NULL DEFAULT 'QUEUE',
  publish_date TIMESTAMPTZ NOT NULL,
  content TEXT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}',
  media JSONB NOT NULL DEFAULT '[]',              -- [{type,path,alt,thumbnail,thumbnailTimestamp}]
  release_id TEXT,                                -- ID que a plataforma devolveu
  release_url TEXT,                               -- URL pública do post publicado
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index otimizado para o scheduler pegar os posts pendentes
CREATE INDEX IF NOT EXISTS idx_posts_queue ON posts(state, publish_date) WHERE state = 'QUEUE';
CREATE INDEX IF NOT EXISTS idx_posts_tenant_state ON posts(tenant_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_group ON posts(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_publish_date ON posts(publish_date) WHERE state IN ('QUEUE','PUBLISHING');