-- Contas sociais conectadas (Instagram, TikTok, LinkedIn, etc.)
CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_identifier TEXT NOT NULL,             -- 'instagram' | 'tiktok' | 'linkedin'
  internal_id TEXT NOT NULL,                      -- ID da conta na plataforma
  name TEXT NOT NULL,
  username TEXT,
  picture TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  additional_settings JSONB NOT NULL DEFAULT '{}',
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  refresh_needed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, provider_identifier, internal_id)
);

CREATE INDEX IF NOT EXISTS idx_integrations_tenant ON integrations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_integrations_provider ON integrations(tenant_id, provider_identifier);