INSERT INTO modules (code, name) VALUES ('BUDGET', 'Budgeting');

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
WHERE m.code = 'BUDGET';

INSERT INTO numbering_sequences (module_code, prefix_template, padding_length, reset_policy) VALUES
    ('BUDGET', 'BUD-{YYYY}-', 6, 'never');
