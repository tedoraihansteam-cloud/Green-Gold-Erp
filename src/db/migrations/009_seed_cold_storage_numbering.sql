INSERT INTO numbering_sequences (module_code, prefix_template, padding_length, reset_policy) VALUES
    ('STORAGE_LOCATION',   'SL-', 6, 'never'),
    ('RENTAL_POLICY',      'RP-', 6, 'never'),
    ('COLD_STORAGE_INVOICE', 'CSI-{YYYYMMDD}-', 6, 'daily');
