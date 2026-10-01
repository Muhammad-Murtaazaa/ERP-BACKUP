-- 034: link an employee record to a login so self-service users (technicians) only see and
-- submit their own time and leave.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_user ON employees (organization_id, user_id) WHERE user_id IS NOT NULL;
