-- 037: FLT vehicles sent to maintenance open a corrective work order in the maintenance (EAM) module.
ALTER TABLE flt_vehicles ADD COLUMN IF NOT EXISTS maintenance_equipment_id UUID REFERENCES maintenance_equipment(id);
ALTER TABLE flt_vehicles ADD COLUMN IF NOT EXISTS maintenance_work_order_id UUID REFERENCES maintenance_work_orders(id);
