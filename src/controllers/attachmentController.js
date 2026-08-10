const { query } = require('../config/db');
const { logAction } = require('../services/auditLogger');

/**
 * Handles file uploads that have already been written to disk by the
 * multer middleware (see routes/attachmentRoutes.js). Covers the "upload
 * regular official expense/bill, attendance, and task report photos from
 * their user profile" requirement - entityType distinguishes what the
 * attachment is for (EXPENSE, ATTENDANCE, TASK_REPORT, etc.) without
 * needing a separate table per attachment kind.
 */
async function upload(req, res) {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const { entityType, entityId, description } = req.body;
    if (!entityType || !entityId) {
        return res.status(400).json({ error: 'entityType and entityId are required' });
    }

    const { rows } = await query(
        `INSERT INTO file_attachments (entity_type, entity_id, uploaded_by, file_path, original_name, file_type, file_size_bytes, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [entityType, entityId, req.user.id, req.file.path, req.file.originalname, req.file.mimetype, req.file.size, description || null]
    );

    await logAction({
        actorUserId: req.user.id,
        action: 'FILE_UPLOADED',
        entityType,
        entityId,
        after: { fileName: req.file.originalname, size: req.file.size }
    });

    res.status(201).json({ attachment: rows[0] });
}

async function listForEntity(req, res) {
    const { entityType, entityId } = req.params;
    const { rows } = await query(
        `SELECT * FROM file_attachments WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC`,
        [entityType, entityId]
    );
    res.json({ attachments: rows });
}

async function download(req, res) {
    const { rows } = await query(`SELECT * FROM file_attachments WHERE id = $1`, [req.params.id]);
    const attachment = rows[0];
    if (!attachment) {
        return res.status(404).json({ error: 'Attachment not found' });
    }
    res.download(attachment.file_path, attachment.original_name);
}

module.exports = { upload, listForEntity, download };
