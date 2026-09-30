-- Payslip email (PLAN B3, E11, E14): where an employee's payslip is emailed and whether they agreed to get it.
-- Kept apart from the record's other fields: only someone who sets up payroll (emp.pay) changes them (employees.ts,
-- setPayslipEmail), and every change is audited by field name, never by value. Consent is off until someone ticks it.
ALTER TABLE emp_employees ADD COLUMN payslip_email TEXT;
ALTER TABLE emp_employees ADD COLUMN payslip_email_consent INTEGER NOT NULL DEFAULT 0 CHECK (payslip_email_consent IN (0,1));
