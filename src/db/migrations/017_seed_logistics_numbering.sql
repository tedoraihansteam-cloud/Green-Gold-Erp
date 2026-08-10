INSERT INTO numbering_sequences (module_code, prefix_template, padding_length, reset_policy) VALUES
    ('VEHICLE',  'VEH-', 6, 'never'),
    ('DELIVERY', 'DEL-{YYYYMMDD}-', 6, 'daily');
