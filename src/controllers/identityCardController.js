const fs = require('fs');
const path = require('path');
const { query } = require('../config/db');
const { logAction } = require('../services/auditLogger');

const TYPES = {
  EMPLOYEE: { table: 'master_employees', column: 'profile_photo_path', permission: 'HR_EDIT' },
  CUSTOMER: { table: 'master_customers', column: 'profile_photo_path', permission: 'SALES_CREATE' },
  VENDOR: { table: 'master_vendors', column: 'profile_photo_path', permission: 'INVENTORY_CREATE' },
  GATE_PASS: { table: 'gate_passes', column: 'visitor_photo_path', permission: 'SECURITY_CREATE' }
};

async function uploadPhoto(req, res) {
  const entityType = String(req.params.entityType || '').toUpperCase();
  const source = TYPES[entityType];
  if (!source) return res.status(400).json({ error: 'Photo supports employee, customer, vendor, and gate pass records' });
  if (!req.permissions.has(source.permission)) return res.status(403).json({ error: `Missing required permission: ${source.permission}` });
  if (!req.file) return res.status(400).json({ error: 'Select a JPG, PNG, or WEBP photo' });
  const before = (await query(`SELECT * FROM ${source.table} WHERE business_id=$1 AND company_id=$2`, [req.params.businessId, req.user.company_id])).rows[0];
  if (!before) { fs.unlink(req.file.path, () => {}); return res.status(404).json({ error: 'Record not found' }); }
  const { rows } = await query(`UPDATE ${source.table} SET ${source.column}=$1 WHERE id=$2 RETURNING *`, [req.file.filename, before.id]);
  if (before[source.column]) {
    const old = path.join(__dirname, '..', '..', 'storage', 'profile-photos', path.basename(before[source.column]));
    if (old !== req.file.path) fs.unlink(old, () => {});
  }
  await logAction({ actorUserId: req.user.id, action: 'PROFILE_PHOTO_UPDATED', entityType, entityId: req.params.businessId, before: { photo: before[source.column] }, after: { photo: req.file.filename } });
  res.json({ record: rows[0], photoUrl: `/files/profile-photos/${req.file.filename}` });
}

module.exports = { uploadPhoto };
