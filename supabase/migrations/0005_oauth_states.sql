-- Estados OAuth temporários (proteção CSRF + PKCE)
CREATE TABLE IF NOT EXISTS oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL UNIQUE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_identifier TEXT NOT NULL,
  redirect_after TEXT,
  code_verifier TEXT,                             -- PKCE
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);

-- Limpa estados expirados automaticamente após 24h
CREATE OR REPLACE FUNCTION cleanup_expired_oauth_states() RETURNS void AS $$
BEGIN
  DELETE FROM oauth_states WHERE expires_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;