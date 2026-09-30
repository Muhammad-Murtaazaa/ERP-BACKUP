-- 018: Event-triggered automation (AUT). Rules subscribe to committed outbox events, evaluate
-- typed conditions and run bounded, non-financial actions (alert / task). Each (rule, event)
-- delivery is unique so replays never repeat an action. Publishing snapshots a version.
CREATE TABLE IF NOT EXISTS automation_event_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    code VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    event_type VARCHAR(80) NOT NULL,
    conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
    actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','PAUSED')),
    version INT NOT NULL DEFAULT 0,
    published_definition JSONB,
    published_at TIMESTAMPTZ,
    published_by UUID REFERENCES users(id),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_event_rule_code UNIQUE (organization_id, code)
);
CREATE TABLE IF NOT EXISTS automation_event_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    rule_id UUID NOT NULL REFERENCES automation_event_rules(id) ON DELETE CASCADE,
    rule_version INT NOT NULL,
    event_id UUID NOT NULL,
    matched BOOLEAN NOT NULL,
    outcome JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_event_delivery UNIQUE (rule_id, event_id)
);
CREATE TABLE IF NOT EXISTS automation_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    rule_id UUID REFERENCES automation_event_rules(id) ON DELETE SET NULL,
    event_id UUID,
    title VARCHAR(255) NOT NULL,
    body TEXT,
    assigned_role VARCHAR(40),
    due_date DATE,
    entity_type VARCHAR(40),
    entity_id UUID,
    status VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DONE','CANCELLED')),
    completed_by UUID REFERENCES users(id),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outbox_org_type_time ON outbox_events(organization_id, event_type, created_at);
