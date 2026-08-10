-- Seed: modules, permissions, numbering sequences.
-- This gives the system a usable starting point without hand-coding
-- business logic into the application layer.

-- ============================================================
-- Modules
-- ============================================================
INSERT INTO modules (code, name) VALUES
    ('DASHBOARD',      'Dashboard'),
    ('INVENTORY',      'Inventory & Warehouse'),
    ('SALES',          'Sales & Billing'),
    ('ACCOUNTS',       'Accounts & Finance'),
    ('HR',             'HR & Payroll'),
    ('COLD_STORAGE',   'Cold Storage & Warehouse Rental'),
    ('MANUFACTURING',  'Manufacturing & Machine Room'),
    ('LOGISTICS',      'Logistics & Delivery'),
    ('SECURITY',       'Security & Gate Pass'),
    ('USER_MANAGEMENT','User Management & Approvals'),
    ('NOTICES',        'Notices & Announcements'),
    ('SETTINGS',       'Settings & Configuration');

-- ============================================================
-- Permissions (view / create / edit / delete / approve per module)
-- ============================================================
INSERT INTO permissions (module_id, code, name)
SELECT m.id, m.code || '_' || action.code, m.name || ' - ' || action.label
FROM modules m
CROSS JOIN (VALUES
    ('VIEW',    'View'),
    ('CREATE',  'Create'),
    ('EDIT',    'Edit'),
    ('DELETE',  'Delete'),
    ('APPROVE', 'Approve')
) AS action(code, label);

-- ============================================================
-- Numbering sequences (one independent counter per module)
-- Placeholders like {YYYY}, {YYYYMMDD} are resolved by the numbering engine.
-- ============================================================
INSERT INTO numbering_sequences (module_code, prefix_template, padding_length, reset_policy) VALUES
    ('EMPLOYEE',    'EMP-HR-{YYYY}-',        6, 'never'),
    ('CUSTOMER',    'CUS-BD-DHK-{YYYY}-',    6, 'never'),
    ('VENDOR',      'VEN-BD-{YYYY}-',        6, 'never'),
    ('INVOICE',     'INV-{YYYYMMDD}-',       6, 'daily'),
    ('GATE_PASS',   'GP-{YYYYMMDD}-',        6, 'daily'),
    ('PURCHASE_ORDER', 'PO-{YYYYMMDD}-',     6, 'daily'),
    ('SALES_ORDER', 'SO-{YYYYMMDD}-',        6, 'daily'),
    ('COLD_STORAGE_CONTRACT', 'CSC-{YYYY}-', 6, 'never'),
    ('WAREHOUSE_ENTRY', 'WE-{YYYYMMDD}-',    6, 'daily'),
    ('WAREHOUSE_EXIT',  'WX-{YYYYMMDD}-',    6, 'daily'),
    ('DELIVERY_CHALLAN', 'DC-{YYYYMMDD}-',   6, 'daily');
