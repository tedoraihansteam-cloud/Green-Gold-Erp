INSERT INTO numbering_sequences (module_code, prefix_template, padding_length, reset_policy) VALUES
    ('MACHINE',  'MCH-', 6, 'never'),
    ('INCIDENT', 'INC-{YYYYMMDD}-', 6, 'daily');
