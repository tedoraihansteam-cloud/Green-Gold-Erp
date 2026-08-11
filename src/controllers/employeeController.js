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

async function updateEmployee(req, res) {
    const { fullName, designation, phone, email, branchId, departmentId, joinDate, status, statusReason } = req.body;
    if (status !== undefined && !['active', 'inactive', 'on_leave', 'terminated'].includes(status)) return res.status(400).json({ error: 'Status must be active, inactive, on_leave, or terminated' });
    if (status !== undefined && !String(statusReason || '').trim()) return res.status(400).json({ error: 'A reason is required when changing employee status' });
    const before = (await query(`SELECT * FROM master_employees WHERE business_id=$1 AND company_id=$2 AND deleted_at IS NULL`, [req.params.businessId, req.user.company_id])).rows[0];
    if (!before) return res.status(404).json({ error: 'Employee not found' });
    const { rows } = await query(
        `UPDATE master_employees SET full_name=COALESCE($1,full_name),designation=$2,phone=$3,email=$4,branch_id=$5,department_id=$6,join_date=$7,status=COALESCE($8,status) WHERE id=$9 RETURNING *`,
        [fullName || null, designation ?? before.designation, phone ?? before.phone, email ?? before.email, branchId === '' ? null : branchId ?? before.branch_id, departmentId === '' ? null : departmentId ?? before.department_id, joinDate === '' ? null : joinDate ?? before.join_date, status || null, before.id]
    );
    await logAction({ actorUserId: req.user.id, action: status && status !== before.status ? 'EMPLOYEE_STATUS_CHANGED' : 'EMPLOYEE_UPDATED', entityType: 'EMPLOYEE', entityId: before.business_id, before, after: { ...rows[0], statusReason: statusReason || null } });
    res.json({ employee: rows[0] });
}

module.exports = { createEmployee, listEmployees, getEmployee, updateEmployee };
