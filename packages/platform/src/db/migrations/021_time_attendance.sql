-- 021: Time & attendance (TIM) — weekly timesheets with clock-range entries (overlap-checked),
-- daily overtime, submit / approve (maker-checker) / post labour cost to GL once, leave requests.
CREATE TABLE IF NOT EXISTS tim_timesheets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    number VARCHAR(40) NOT NULL,
    employee_id UUID NOT NULL REFERENCES employees(id),
    week_start DATE NOT NULL,
    cost_rate NUMERIC(24,8) NOT NULL CHECK (cost_rate >= 0),
    total_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
    overtime_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
    cost_amount NUMERIC(24,8) NOT NULL DEFAULT 0,
    status VARCHAR(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','POSTED')),
    notes TEXT,
    reject_reason TEXT,
    submitted_at TIMESTAMPTZ,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    journal_id UUID REFERENCES journals(id),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tim_sheet_week UNIQUE (organization_id, employee_id, week_start),
    CONSTRAINT ck_tim_week_monday CHECK (EXTRACT(ISODOW FROM week_start) = 1)
);

CREATE TABLE IF NOT EXISTS tim_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    timesheet_id UUID NOT NULL REFERENCES tim_timesheets(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id),
    work_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    hours NUMERIC(6,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
    project_id UUID REFERENCES projects(id),
    activity VARCHAR(255) NOT NULL,
    billable BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_tim_entry_window CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_tim_entries_emp_date ON tim_entries(employee_id, work_date);

CREATE TABLE IF NOT EXISTS tim_leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    employee_id UUID NOT NULL REFERENCES employees(id),
    leave_type VARCHAR(16) NOT NULL CHECK (leave_type IN ('ANNUAL','SICK','CASUAL','UNPAID','MATERNITY','PATERNITY','HAJJ')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    days NUMERIC(6,1) NOT NULL,
    reason TEXT,
    status VARCHAR(12) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','REJECTED','CANCELLED')),
    decided_by UUID REFERENCES users(id),
    decision_note TEXT,
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_tim_leave_window CHECK (end_date >= start_date)
);
