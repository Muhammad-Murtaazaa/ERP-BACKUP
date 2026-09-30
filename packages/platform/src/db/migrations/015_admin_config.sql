-- 015: Client administration & configuration (ADM/CFG). Versioned org settings with
-- append-only history, and per-organization module lifecycle state (MODULE-CONTRACT.md).
CREATE TABLE IF NOT EXISTS org_settings (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    setting_key VARCHAR(80) NOT NULL,
    value JSONB NOT NULL,
    version INT NOT NULL DEFAULT 1,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, setting_key)
);
CREATE TABLE IF NOT EXISTS org_setting_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    setting_key VARCHAR(80) NOT NULL,
    version INT NOT NULL,
    old_value JSONB,
    new_value JSONB NOT NULL,
    reason TEXT,
    changed_by UUID REFERENCES users(id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_setting_version UNIQUE (organization_id, setting_key, version)
);
CREATE TABLE IF NOT EXISTS module_states (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    module_code VARCHAR(8) NOT NULL,
    state VARCHAR(16) NOT NULL DEFAULT 'enabled' CHECK (state IN ('available','enabled','draining','read_only','disabled')),
    reason TEXT,
    changed_by UUID REFERENCES users(id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, module_code)
);
CREATE OR REPLACE FUNCTION forbid_setting_history_change() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_APPEND_ONLY: setting history is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_setting_history_append_only ON org_setting_history;
CREATE TRIGGER trg_setting_history_append_only BEFORE UPDATE OR DELETE ON org_setting_history
  FOR EACH ROW EXECUTE FUNCTION forbid_setting_history_change();
