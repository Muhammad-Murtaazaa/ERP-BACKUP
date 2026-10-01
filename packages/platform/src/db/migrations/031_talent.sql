-- 031: Recruitment & talent (TAL) — approved requisitions, candidate pool, application pipeline,
-- scored interviews, offers within band, and hire -> employee record.
CREATE TABLE IF NOT EXISTS tal_requisitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    number VARCHAR(40) NOT NULL,
    title VARCHAR(255) NOT NULL,
    department VARCHAR(120),
    location VARCHAR(120),
    employment_type VARCHAR(16) NOT NULL DEFAULT 'FULL_TIME' CHECK (employment_type IN ('FULL_TIME','PART_TIME','CONTRACT','INTERN')),
    positions INT NOT NULL DEFAULT 1 CHECK (positions BETWEEN 1 AND 100),
    filled INT NOT NULL DEFAULT 0 CHECK (filled >= 0),
    salary_min NUMERIC(24,8) NOT NULL CHECK (salary_min > 0),
    salary_max NUMERIC(24,8) NOT NULL,
    target_date DATE,
    justification TEXT,
    submitted_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    hold_reason TEXT,
    status VARCHAR(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','OPEN','ON_HOLD','FILLED','CANCELLED')),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_tal_band CHECK (salary_max >= salary_min),
    CONSTRAINT ck_tal_filled CHECK (filled <= positions)
);

CREATE TABLE IF NOT EXISTS tal_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    full_name VARCHAR(200) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    source VARCHAR(12) NOT NULL DEFAULT 'JOB_BOARD' CHECK (source IN ('REFERRAL','JOB_BOARD','WALK_IN','AGENCY','LINKEDIN','CAMPUS')),
    skills TEXT,
    years_experience NUMERIC(4,1) CHECK (years_experience IS NULL OR years_experience >= 0),
    current_city VARCHAR(120),
    status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tal_candidate_email ON tal_candidates (organization_id, LOWER(email));

CREATE TABLE IF NOT EXISTS tal_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    requisition_id UUID NOT NULL REFERENCES tal_requisitions(id),
    candidate_id UUID NOT NULL REFERENCES tal_candidates(id),
    applied_on DATE NOT NULL DEFAULT CURRENT_DATE,
    offered_salary NUMERIC(24,8),
    offer_start_date DATE,
    offer_note TEXT,
    rejection_reason TEXT,
    employee_id UUID REFERENCES employees(id),
    status VARCHAR(12) NOT NULL DEFAULT 'APPLIED' CHECK (status IN ('APPLIED','SCREENING','INTERVIEW','OFFER','HIRED','REJECTED','WITHDRAWN')),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tal_application UNIQUE (requisition_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS tal_interviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    application_id UUID NOT NULL REFERENCES tal_applications(id),
    interview_date DATE NOT NULL,
    interviewer VARCHAR(120) NOT NULL,
    round VARCHAR(16) NOT NULL DEFAULT 'TECHNICAL' CHECK (round IN ('PHONE','TECHNICAL','PRACTICAL','HR','FINAL')),
    score INT NOT NULL CHECK (score BETWEEN 1 AND 5),
    recommendation VARCHAR(8) NOT NULL CHECK (recommendation IN ('HIRE','MAYBE','NO_HIRE')),
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
