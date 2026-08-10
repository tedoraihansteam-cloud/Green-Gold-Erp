const { query } = require('../config/db');
const { logAction } = require('../services/auditLogger');
const {generateNextId}=require('../services/numberingEngine');

async function publicInfo(req, res) {
    // Public by design (no auth) - a single-tenant internal tool's
    // registration form needs to know which company to sign up under
    // before the user has any credentials. Only name/id are exposed.
    const { rows } = await query(`SELECT id, name FROM companies ORDER BY created_at LIMIT 1`);
    if (rows.length === 0) return res.status(404).json({ error: 'No company has been set up yet' });
    res.json({ company: rows[0] });
}

async function createBranch(req, res) {
    const { name, address } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const { rows } = await query(
        `INSERT INTO branches (company_id, name, address) VALUES ($1, $2, $3) RETURNING *`,
        [req.user.company_id, name, address || null]
    );
    await logAction({ actorUserId: req.user.id, action: 'BRANCH_CREATED', entityType: 'BRANCH', entityId: rows[0].id, after: rows[0] });
    res.status(201).json({ branch: rows[0] });
}

async function listBranches(req, res) {
    const { rows } = await query(`SELECT * FROM branches WHERE company_id = $1 ORDER BY name`, [req.user.company_id]);
    res.json({ branches: rows });
}

async function createDepartment(req, res) {
    const {siteId,name,code,description,headEmployeeId,costCenterId,operationalSettings}=req.body;
    if(!siteId||!name||!code)return res.status(400).json({error:'Configured office/factory location, department name, and unique code are required'});
    const businessId=await generateNextId('DEPARTMENT');
    const site=(await query(`SELECT * FROM company_sites WHERE id=$1 AND company_id=$2`,[siteId,req.user.company_id])).rows[0];if(!site)return res.status(404).json({error:'Configured company location not found'});let branch=(await query(`SELECT id FROM branches WHERE company_id=$1 AND lower(name)=lower($2) ORDER BY created_at LIMIT 1`,[req.user.company_id,site.name])).rows[0];if(!branch)branch=(await query(`INSERT INTO branches(company_id,name,address) VALUES($1,$2,$3) RETURNING id`,[req.user.company_id,site.name,site.address||null])).rows[0];

    const { rows } = await query(
        `INSERT INTO departments(business_id,branch_id,company_site_id,name,code,description,head_employee_id,cost_center_id,operational_settings) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [businessId,branch.id,site.id,name,String(code).toUpperCase(),description||null,headEmployeeId||null,costCenterId||null,JSON.stringify(operationalSettings||{})]
    );
    await logAction({ actorUserId: req.user.id, action: 'DEPARTMENT_CREATED', entityType: 'DEPARTMENT', entityId: rows[0].id, after: rows[0] });
    res.status(201).json({ department: rows[0] });
}

async function listDepartments(req, res) {
    const { branchId } = req.query;
    const { rows } = await query(
        `SELECT d.*,cs.name site_name,cs.site_type,cs.address site_address,e.full_name head_name,cc.business_id cost_center_business_id,cc.name cost_center_name,(SELECT count(*)::int FROM master_employees me WHERE me.department_id=d.id AND me.deleted_at IS NULL) staff_count FROM departments d JOIN branches b ON b.id=d.branch_id LEFT JOIN company_sites cs ON cs.id=d.company_site_id LEFT JOIN master_employees e ON e.id=d.head_employee_id LEFT JOIN cost_centers cc ON cc.id=d.cost_center_id
         WHERE b.company_id = $1 AND ($2::uuid IS NULL OR d.branch_id = $2)
         ORDER BY d.name`,
        [req.user.company_id, branchId || null]
    );
    res.json({ departments: rows });
}

async function departmentDetail(req,res){const department=(await query(`SELECT d.*,b.name branch_name,e.full_name head_name,cc.name cost_center_name FROM departments d JOIN branches b ON b.id=d.branch_id LEFT JOIN master_employees e ON e.id=d.head_employee_id LEFT JOIN cost_centers cc ON cc.id=d.cost_center_id WHERE d.business_id=$1 AND b.company_id=$2`,[req.params.businessId,req.user.company_id])).rows[0];if(!department)return res.status(404).json({error:'Department not found'});const [staff,workflows,requests]=await Promise.all([query(`SELECT business_id,full_name,designation,status FROM master_employees WHERE department_id=$1 AND deleted_at IS NULL ORDER BY full_name`,[department.id]),query(`SELECT workflow_key,display_name,approval_steps,enabled FROM workflow_definitions WHERE company_id=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(approval_steps) s WHERE lower(s->>'department')=lower($2) OR lower(s->>'department')=lower($3))`,[req.user.company_id,department.code,department.name]),query(`SELECT business_id,request_type,subject,status,created_at FROM portal_requests WHERE company_id=$1 AND lower(department)=lower($2) ORDER BY created_at DESC LIMIT 100`,[req.user.company_id,department.code])]);res.json({department:{...department,staff:staff.rows,workflows:workflows.rows,requests:requests.rows}});}
async function updateDepartment(req,res){const {name,code,description,branchId,headEmployeeId,costCenterId,phone,email,status,operationalSettings}=req.body;const {rows}=await query(`UPDATE departments d SET name=COALESCE($1,name),code=COALESCE($2,code),description=$3,branch_id=COALESCE($4,branch_id),head_employee_id=$5,cost_center_id=$6,phone=$7,email=$8,status=COALESCE($9,status),operational_settings=COALESCE($10::jsonb,operational_settings),updated_at=now() FROM branches b WHERE d.business_id=$11 AND d.branch_id=b.id AND b.company_id=$12 RETURNING d.*`,[name||null,code?String(code).toUpperCase():null,description||null,branchId||null,headEmployeeId||null,costCenterId||null,phone||null,email||null,status||null,operationalSettings?JSON.stringify(operationalSettings):null,req.params.businessId,req.user.company_id]);if(!rows.length)return res.status(404).json({error:'Department not found'});await logAction({actorUserId:req.user.id,action:'DEPARTMENT_UPDATED',entityType:'DEPARTMENT',entityId:req.params.businessId,after:rows[0]});res.json({department:rows[0]});}
async function assignStaff(req,res){const {employeeBusinessIds}=req.body;if(!Array.isArray(employeeBusinessIds))return res.status(400).json({error:'employeeBusinessIds array is required'});const result=await query(`UPDATE master_employees e SET department_id=d.id,branch_id=d.branch_id FROM departments d JOIN branches b ON b.id=d.branch_id WHERE d.business_id=$1 AND b.company_id=$2 AND e.company_id=$2 AND e.business_id=ANY($3::text[]) RETURNING e.business_id,e.full_name`,[req.params.businessId,req.user.company_id,employeeBusinessIds]);res.json({assigned:result.rows});}
async function listSites(req,res){const {rows}=await query(`SELECT id,site_type,name,address,latitude,longitude,is_document_address FROM company_sites WHERE company_id=$1 ORDER BY site_type,name`,[req.user.company_id]);res.json({sites:rows});}
async function departmentDetailV2(req,res){const department=(await query(`SELECT d.*,cs.name site_name,cs.site_type,cs.address site_address,e.full_name head_name,cc.name cost_center_name FROM departments d JOIN branches b ON b.id=d.branch_id LEFT JOIN company_sites cs ON cs.id=d.company_site_id LEFT JOIN master_employees e ON e.id=d.head_employee_id LEFT JOIN cost_centers cc ON cc.id=d.cost_center_id WHERE d.business_id=$1 AND b.company_id=$2`,[req.params.businessId,req.user.company_id])).rows[0];if(!department)return res.status(404).json({error:'Department not found'});const [staff,workflows,requests]=await Promise.all([query(`SELECT business_id,full_name,designation,status FROM master_employees WHERE department_id=$1 AND deleted_at IS NULL ORDER BY full_name`,[department.id]),query(`SELECT workflow_key,display_name,approval_steps,enabled FROM workflow_definitions WHERE company_id=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(approval_steps) s WHERE lower(s->>'department') IN(lower($2),lower($3)))`,[req.user.company_id,department.code,department.name]),query(`SELECT business_id,request_type,subject,status,created_at FROM portal_requests WHERE company_id=$1 AND lower(department)=lower($2) ORDER BY created_at DESC LIMIT 100`,[req.user.company_id,department.code])]);res.json({department:{...department,staff:staff.rows,workflows:workflows.rows,requests:requests.rows}});}
async function updateDepartmentV2(req,res){const {name,code,description,siteId,headEmployeeId,costCenterId,status,operationalSettings}=req.body;let site=null,branch=null;if(siteId){site=(await query(`SELECT * FROM company_sites WHERE id=$1 AND company_id=$2`,[siteId,req.user.company_id])).rows[0];if(!site)return res.status(404).json({error:'Configured company location not found'});branch=(await query(`SELECT id FROM branches WHERE company_id=$1 AND lower(name)=lower($2) LIMIT 1`,[req.user.company_id,site.name])).rows[0];if(!branch)branch=(await query(`INSERT INTO branches(company_id,name,address) VALUES($1,$2,$3) RETURNING id`,[req.user.company_id,site.name,site.address||null])).rows[0];}const {rows}=await query(`UPDATE departments d SET name=COALESCE($1,name),code=COALESCE($2,code),description=$3,branch_id=COALESCE($4,branch_id),company_site_id=COALESCE($5,company_site_id),head_employee_id=$6,cost_center_id=$7,status=COALESCE($8,status),operational_settings=COALESCE($9::jsonb,operational_settings),updated_at=now() FROM branches b WHERE d.business_id=$10 AND d.branch_id=b.id AND b.company_id=$11 RETURNING d.*`,[name||null,code?String(code).toUpperCase():null,description||null,branch?.id||null,site?.id||null,headEmployeeId||null,costCenterId||null,status||null,operationalSettings?JSON.stringify(operationalSettings):null,req.params.businessId,req.user.company_id]);if(!rows.length)return res.status(404).json({error:'Department not found'});res.json({department:rows[0]});}

module.exports = {createBranch,listBranches,listSites,createDepartment,listDepartments,departmentDetail:departmentDetailV2,updateDepartment:updateDepartmentV2,assignStaff,publicInfo};
