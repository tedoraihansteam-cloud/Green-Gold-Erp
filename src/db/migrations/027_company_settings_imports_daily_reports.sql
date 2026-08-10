CREATE TABLE company_profiles (
 company_id UUID PRIMARY KEY REFERENCES companies(id), logo_path TEXT, tagline TEXT, slogan TEXT,
 phone TEXT,email TEXT,website TEXT,registration_number TEXT,tax_number TEXT,currency TEXT NOT NULL DEFAULT 'BDT',
 seal_path TEXT,updated_by UUID REFERENCES users(id),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE company_sites (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id UUID NOT NULL REFERENCES companies(id),site_type TEXT NOT NULL,
 name TEXT NOT NULL,address TEXT,contact_name TEXT,contact_phone TEXT,latitude NUMERIC(10,7),longitude NUMERIC(10,7),is_document_address BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE bulk_import_jobs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),business_id TEXT NOT NULL UNIQUE,company_id UUID NOT NULL REFERENCES companies(id),
 import_type TEXT NOT NULL,original_name TEXT NOT NULL,file_path TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'review',
 detected_columns JSONB NOT NULL DEFAULT '[]',preview_rows JSONB NOT NULL DEFAULT '[]',field_mapping JSONB NOT NULL DEFAULT '{}',
 validation_errors JSONB NOT NULL DEFAULT '[]',created_by UUID NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 submitted_by UUID REFERENCES users(id),submitted_at TIMESTAMPTZ
);
CREATE TABLE daily_financial_reports (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),business_id TEXT NOT NULL UNIQUE,company_id UUID NOT NULL REFERENCES companies(id),
 report_date DATE NOT NULL,status TEXT NOT NULL DEFAULT 'prepared',snapshot JSONB NOT NULL,prepared_by UUID NOT NULL REFERENCES users(id),prepared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 reviewed_by UUID REFERENCES users(id),reviewed_at TIMESTAMPTZ,approved_by UUID REFERENCES users(id),approved_at TIMESTAMPTZ,
 authorized_by UUID REFERENCES users(id),authorized_at TIMESTAMPTZ,review_notes TEXT,UNIQUE(company_id,report_date)
);
CREATE TABLE document_signoffs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),company_id UUID NOT NULL REFERENCES companies(id),entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,
 signoff_role TEXT NOT NULL,user_id UUID REFERENCES users(id),external_name TEXT,status TEXT NOT NULL DEFAULT 'pending',signed_at TIMESTAMPTZ,notes TEXT,
 UNIQUE(entity_type,entity_id,signoff_role)
);
INSERT INTO numbering_sequences(module_code,prefix_template,padding_length,reset_policy) VALUES
 ('BULK_IMPORT','IMP-{YYYYMMDD}-',6,'daily'),('DAILY_FINANCIAL_REPORT','DFR-{YYYYMMDD}-',4,'daily');
