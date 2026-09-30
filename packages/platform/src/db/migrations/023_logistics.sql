-- 023: Logistics (LOG) — carriers, shipments with booking / transit / proof of delivery,
-- replay-safe tracking events, and one-time freight cost posting.
CREATE TABLE IF NOT EXISTS log_carriers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    mode VARCHAR(12) NOT NULL CHECK (mode IN ('ROAD','AIR','SEA','RAIL','COURIER','OWN_FLEET')),
    party_id UUID REFERENCES parties(id),
    tracking_url_template VARCHAR(500),
    status VARCHAR(12) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_log_carrier_code UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS log_shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_entity_id UUID REFERENCES legal_entities(id),
    number VARCHAR(40) NOT NULL,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('OUTBOUND','INBOUND')),
    carrier_id UUID REFERENCES log_carriers(id),
    party_id UUID REFERENCES parties(id),
    sales_order_id UUID REFERENCES sales_orders(id),
    purchase_order_id UUID REFERENCES purchase_orders(id),
    origin VARCHAR(255) NOT NULL,
    destination VARCHAR(255) NOT NULL,
    packages INT NOT NULL DEFAULT 1 CHECK (packages > 0),
    weight_kg NUMERIC(12,3),
    planned_ship_date DATE,
    promised_date DATE,
    tracking_number VARCHAR(80),
    shipped_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    pod_name VARCHAR(255),
    pod_note TEXT,
    exception_reason TEXT,
    freight_amount NUMERIC(24,8) NOT NULL DEFAULT 0 CHECK (freight_amount >= 0),
    freight_journal_id UUID REFERENCES journals(id),
    status VARCHAR(12) NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','BOOKED','IN_TRANSIT','DELIVERED','EXCEPTION','CANCELLED')),
    revision INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_log_promised CHECK (promised_date IS NULL OR planned_ship_date IS NULL OR promised_date >= planned_ship_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_log_tracking ON log_shipments(organization_id, carrier_id, tracking_number) WHERE tracking_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS log_tracking_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    shipment_id UUID NOT NULL REFERENCES log_shipments(id),
    event_at TIMESTAMPTZ NOT NULL,
    code VARCHAR(24) NOT NULL CHECK (code IN ('BOOKED','PICKED_UP','IN_TRANSIT','AT_HUB','OUT_FOR_DELIVERY','DELIVERED','EXCEPTION','NOTE')),
    location VARCHAR(255),
    note TEXT,
    source VARCHAR(12) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','CARRIER','SYSTEM')),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_log_event UNIQUE (shipment_id, event_at, code)
);
