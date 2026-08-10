const notificationService = require('../services/notificationService');
const { logAction } = require('../services/auditLogger');

async function create(req, res) {
    const { title, body, targetType, targetValue, sendEmail, sendPush, sendSms, expiresAt } = req.body;
    if (!title || !body) {
        return res.status(400).json({ error: 'title and body are required' });
    }

    const notice = await notificationService.createNotice({
        title, body, createdBy: req.user.id, targetType, targetValue, sendEmail, sendPush, sendSms, expiresAt
    });

    await logAction({ actorUserId: req.user.id, action: 'NOTICE_CREATED', entityType: 'NOTICE', entityId: notice.id, after: { title, targetType, targetValue } });
    res.status(201).json({ notice });
}

async function listMine(req, res) {
    const notices = await notificationService.getNoticesForUser(req.user.id);
    res.json({ notices });
}

async function markRead(req, res) {
    await notificationService.markRead(req.params.id, req.user.id);
    res.json({ message: 'Marked as read' });
}

async function acknowledge(req, res) {
    await notificationService.acknowledge(req.params.id, req.user.id);
    res.json({ message: 'Acknowledged' });
}

module.exports = { create, listMine, markRead, acknowledge };
