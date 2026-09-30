-- 020: CRM — leads with duplicate detection, conversion to customer + opportunity, a staged
-- pipeline with weighted forecast, won/lost with mandatory loss reason, and activities.
CREATE TABLE IF NOT EXISTS crm_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    number VARCHAR(40) NOT NULL,
    name VARCHAR(255) NOT NULL,
    company VARCHAR(255),
    email VARCHAR(255),
    email_norm VARCHAR(255),
    phone VARCHAR(40),
    phone_norm VARCHAR(40),
    source VARCHAR(24) NOT NULL DEFAULT 'WEBSITE' CHECK (source IN ('WEBSITE','REFERRAL','WALK_IN','PHONE','SOCIAL','PARTNER','EVENT','OTHER')),
    interest TEXT,
    city VARCHAR(80),
    estimated_value NUMERIC(24,8) NOT NULL DEFAULT 0 CHECK (estimated_value >= 0),
    owner_user_id UUID REFERENCES users(id),
    status VARCHAR(16) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONTACTED','QUALIFIED','CONVERTED','DISQUALIFIED')),
    disqualify_reason TEXT,
    party_id UUID REFERENCES parties(id),
    opportunity_id UUID,
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_leads_email ON crm_leads(organization_id, email_norm);
CREATE INDEX IF NOT EXISTS idx_crm_leads_phone ON crm_leads(organization_id, phone_norm);

CREATE TABLE IF NOT EXISTS crm_opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    number VARCHAR(40) NOT NULL,
    name VARCHAR(255) NOT NULL,
    party_id UUID NOT NULL REFERENCES parties(id),
    lead_id UUID REFERENCES crm_leads(id),
    amount NUMERIC(24,8) NOT NULL DEFAULT 0 CHECK (amount >= 0),
    stage VARCHAR(16) NOT NULL DEFAULT 'PROSPECTING' CHECK (stage IN ('PROSPECTING','QUALIFICATION','SITE_SURVEY','PROPOSAL','NEGOTIATION','WON','LOST')),
    probability INT NOT NULL DEFAULT 10 CHECK (probability BETWEEN 0 AND 100),
    expected_close_date DATE,
    owner_user_id UUID REFERENCES users(id),
    status VARCHAR(8) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','WON','LOST')),
    lost_reason VARCHAR(32) CHECK (lost_reason IS NULL OR lost_reason IN ('PRICE','COMPETITOR','NO_BUDGET','TIMING','NO_RESPONSE','SCOPE','OTHER')),
    lost_notes TEXT,
    closed_at TIMESTAMPTZ,
    service_case_id UUID REFERENCES srv_cases(id),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_crm_lost_reason CHECK (status <> 'LOST' OR lost_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS crm_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    activity_type VARCHAR(16) NOT NULL CHECK (activity_type IN ('CALL','MEETING','EMAIL','SITE_VISIT','TASK','WHATSAPP')),
    subject VARCHAR(255) NOT NULL,
    notes TEXT,
    due_at TIMESTAMPTZ,
    lead_id UUID REFERENCES crm_leads(id),
    opportunity_id UUID REFERENCES crm_opportunities(id),
    party_id UUID REFERENCES parties(id),
    outcome TEXT,
    status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DONE','CANCELLED')),
    completed_at TIMESTAMPTZ,
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_crm_activity_target CHECK (lead_id IS NOT NULL OR opportunity_id IS NOT NULL OR party_id IS NOT NULL)
);
