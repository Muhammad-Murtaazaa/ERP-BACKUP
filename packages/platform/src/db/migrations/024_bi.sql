-- 024: Governed BI — dashboards composed of widgets over a code-defined, permission-scoped
-- dataset catalogue (no caller-supplied SQL). Widget definitions are validated on save.
CREATE TABLE IF NOT EXISTS bi_dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    code VARCHAR(40) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    widgets JSONB NOT NULL DEFAULT '[]'::jsonb,
    visibility VARCHAR(8) NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PRIVATE','SHARED')),
    status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_bi_dashboard_code UNIQUE (organization_id, code)
);
