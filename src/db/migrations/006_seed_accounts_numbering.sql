INSERT INTO numbering_sequences (module_code, prefix_template, padding_length, reset_policy) VALUES
    ('ACCOUNT', 'ACC-', 6, 'never'),
    ('EXPENSE', 'EXP-{YYYYMMDD}-', 6, 'daily');
