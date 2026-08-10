const { query, withTransaction } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { generateForEntity } = require('../services/qrBarcodeService');
const { logAction } = require('../services/auditLogger');

async function createEmployee(req, res) {
    const { fullName, designation, phone, email, branchId, departmentId, joinDate } = req.body;
    if (!fullName) {
        return res.status(400).json({ error: 'fullName is required' });
    }

    const employee = await withTransaction(async (client) => {
        const businessId = await generateNextId('EMPLOYEE');
        const { rows } = await client.query(
            `INSERT INTO master_employees (business_id, company_id, branch_id, department_id, full_name, designation, phone, email, join_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [businessId, req.user.company_id, branchId || null, departmentId || null, fullName, designation || null, phone || null, email || null, joinDate || null]
        );
        return rows[0];
    });

    await generateForEntity('EMPLOYEE', employee.business_id);
    await logAction({ actorUserId: req.user.id, action: 'EMPLOYEE_CREATED', entityType: 'EMPLOYEE', entityId: employee.business_id, after: employee });

    res.status(201).json({ employee });
}

async function listEmployees(req, res) {
    const { rows } = await query(
        `SELECT e.*,d.business_id department_business_id,d.name department_name,d.code department_code,b.name branch_name,cs.name site_name,cs.site_type,cs.address site_address FROM master_employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN branches b ON b.id=e.branch_id LEFT JOIN company_sites cs ON cs.id=d.company_site_id WHERE e.company_id=$1 AND e.deleted_at IS NULL ORDER BY e.created_at DESC`,
        [req.user.company_id]
    );
    res.json({ employees: rows });
}

async function getEmployee(req, res) {
    const { rows } = await query(
        `SELECT * FROM master_employees WHERE business_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [req.params.businessId, req.user.company_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json({ employee: rows[0] });
}

module.exports = { createEmployee, listEmployees, getEmployee };
