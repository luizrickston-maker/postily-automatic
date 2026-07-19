-- Tenants: agência (multi-client) ou cliente standalone
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('agency', 'client')),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  external_id TEXT,                              -- ID no sistema externo (ex: client_id no taskvision)
  parent_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_parent ON tenants(parent_id);
CREATE INDEX IF NOT EXISTS idx_tenants_external ON tenants(external_id);
CREATE INDEX IF NOT EXISTS idx_tenants_type ON tenants(type);

COMMENT ON COLUMN tenants.external_id IS 'ID no sistema externo para integração futura (taskvision)';