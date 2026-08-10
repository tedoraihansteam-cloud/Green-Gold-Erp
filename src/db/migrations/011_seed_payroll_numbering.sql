INSERT INTO numbering_sequences (module_code, prefix_template, padding_length, reset_policy) VALUES
    ('SALARY_TEMPLATE', 'ST-', 6, 'never'),
    ('PAYROLL_RUN', 'PR-{YYYY}{MM}-', 4, 'monthly');
