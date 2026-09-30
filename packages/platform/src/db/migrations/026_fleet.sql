-- 026: Fleet (FLT) — service vans and vehicles, conflict-free assignments, fuel logs with
-- monotonic odometer, fuel efficiency and one-time expense posting; compliance expiry dates.
CREATE TABLE IF NOT EXISTS flt_vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    code VARCHAR(32) NOT NULL,
    registration VARCHAR(32) NOT NULL,
    make_model VARCHAR(120) NOT NULL,
    model_year INT CHECK (model_year IS NULL OR model_year BETWEEN 1980 AND 2100),
    fuel_type VARCHAR(10) NOT NULL DEFAULT 'PETROL' CHECK (fuel_type IN ('PETROL','DIESEL','CNG','HYBRID','EV')),
    odometer_km NUMERIC(12,1) NOT NULL DEFAULT 0 CHECK (odometer_km >= 0),
    insurance_expiry DATE,
    fitness_expiry DATE,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','IN_MAINTENANCE','RETIRED')),
    status_note TEXT,
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_flt_code UNIQUE (organization_id, code),
    CONSTRAINT uq_flt_reg UNIQUE (organization_id, registration)
);

CREATE TABLE IF NOT EXISTS flt_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    vehicle_id UUID NOT NULL REFERENCES flt_vehicles(id),
    technician_id UUID NOT NULL REFERENCES srv_technicians(id),
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    purpose VARCHAR(255),
    returned_at TIMESTAMPTZ,
    status VARCHAR(12) NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED','RETURNED','CANCELLED')),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_flt_assign_window CHECK (end_at > start_at)
);

CREATE TABLE IF NOT EXISTS flt_fuel_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    vehicle_id UUID NOT NULL REFERENCES flt_vehicles(id),
    log_date DATE NOT NULL,
    odometer_km NUMERIC(12,1) NOT NULL CHECK (odometer_km >= 0),
    previous_odometer_km NUMERIC(12,1),
    litres NUMERIC(10,2) NOT NULL CHECK (litres > 0),
    amount NUMERIC(24,8) NOT NULL CHECK (amount > 0),
    station VARCHAR(120),
    paid_by VARCHAR(10) NOT NULL DEFAULT 'CASH' CHECK (paid_by IN ('CASH','ACCOUNT')),
    km_per_litre NUMERIC(8,2),
    journal_id UUID REFERENCES journals(id),
    status VARCHAR(10) NOT NULL DEFAULT 'LOGGED' CHECK (status IN ('LOGGED','POSTED','VOID')),
    void_reason TEXT,
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
