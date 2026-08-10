INSERT INTO modules (code, name) VALUES ('REPORTS', 'Reports & Analytics');

INSERT INTO permissions (module_id, code, name)
SELECT m.id, m.code || '_' || action.code, m.name || ' - ' || action.label
FROM modules m
CROSS JOIN (VALUES
    ('VIEW',    'View'),
    ('CREATE',  'Create'),
    ('EDIT',    'Edit'),
    ('DELETE',  'Delete'),
    ('APPROVE', 'Approve')
) AS action(code, label)
WHERE m.code = 'REPORTS';
