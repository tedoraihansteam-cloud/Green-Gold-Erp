CREATE TABLE manufacturing_shifts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES companies(id),
 name TEXT NOT NULL, start_time TIME NOT NULL, end_time TIME NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
 is_active BOOLEAN NOT NULL DEFAULT true, created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(company_id,name)
);
CREATE TABLE machine_shift_reports (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id TEXT NOT NULL UNIQUE, company_id UUID NOT NULL REFERENCES companies(id),
 shift_id UUID NOT NULL REFERENCES manufacturing_shifts(id), report_date DATE NOT NULL, reporter_id UUID NOT NULL REFERENCES users(id),
 overall_summary TEXT, handover_notes TEXT, handover_to_user_id UUID REFERENCES users(id), status TEXT NOT NULL DEFAULT 'submitted',
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(), acknowledged_at TIMESTAMPTZ, UNIQUE(company_id,shift_id,report_date,reporter_id)
);
CREATE TABLE machine_shift_report_entries (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), report_id UUID NOT NULL REFERENCES machine_shift_reports(id) ON DELETE CASCADE,
 machine_id UUID NOT NULL REFERENCES machines(id), operated BOOLEAN NOT NULL DEFAULT true, run_start TIME, run_end TIME,
 still_running BOOLEAN NOT NULL DEFAULT false, running_minutes INTEGER NOT NULL DEFAULT 0,
 condition_status TEXT NOT NULL DEFAULT 'all_good', notes TEXT, remarks TEXT, follow_up_instruction TEXT,
 UNIQUE(report_id,machine_id)
);
CREATE INDEX machine_shift_reports_date ON machine_shift_reports(company_id,report_date DESC);
CREATE INDEX machine_shift_entries_machine ON machine_shift_report_entries(machine_id);
INSERT INTO manufacturing_shifts(company_id,name,start_time,end_time,sort_order,created_by)
SELECT id,'Shift 1','06:00','14:00',1,NULL FROM companies ON CONFLICT DO NOTHING;
INSERT INTO manufacturing_shifts(company_id,name,start_time,end_time,sort_order,created_by)
SELECT id,'Shift 2','14:00','22:00',2,NULL FROM companies ON CONFLICT DO NOTHING;
INSERT INTO manufacturing_shifts(company_id,name,start_time,end_time,sort_order,created_by)
SELECT id,'Shift 3','22:00','06:00',3,NULL FROM companies ON CONFLICT DO NOTHING;
INSERT INTO numbering_sequences(module_code,prefix_template,padding_length,reset_policy)
VALUES('MACHINE_SHIFT_REPORT','MSR-{YYYYMMDD}-',4,'daily') ON CONFLICT(module_code) DO NOTHING;
