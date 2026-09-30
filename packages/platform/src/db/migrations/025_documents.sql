-- 025: Document management (DOC) — versioned documents (sha256, size and type checked), links to
-- business records, review/approval with maker-checker, retention and legal hold.
CREATE TABLE IF NOT EXISTS doc_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    number VARCHAR(40) NOT NULL,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(20) NOT NULL CHECK (category IN ('CONTRACT','WARRANTY_CARD','SITE_PHOTO','INVOICE','CERTIFICATE','DRAWING','POLICY','HR','OTHER')),
    entity_type VARCHAR(32),
    entity_id UUID,
    current_version INT NOT NULL DEFAULT 0,
    retention_until DATE,
    legal_hold BOOLEAN NOT NULL DEFAULT false,
    hold_reason TEXT,
    status VARCHAR(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','OBSOLETE','DELETED')),
    submitted_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_doc_link CHECK ((entity_type IS NULL) = (entity_id IS NULL)),
    CONSTRAINT ck_doc_hold_not_deleted CHECK (NOT (legal_hold AND status = 'DELETED'))
);
CREATE INDEX IF NOT EXISTS idx_doc_entity ON doc_documents(organization_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS doc_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES doc_documents(id),
    version_no INT NOT NULL CHECK (version_no > 0),
    filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(80) NOT NULL,
    size_bytes INT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
    sha256 CHAR(64) NOT NULL,
    content BYTEA,
    note TEXT,
    uploaded_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_doc_version UNIQUE (document_id, version_no)
);
