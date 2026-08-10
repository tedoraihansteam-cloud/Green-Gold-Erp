const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const controller = require('../controllers/workforceController');

const router = express.Router();

function requireStaff(req, res, next) {
    if (req.user.account_type !== 'staff') {
        return res.status(403).json({ error: 'Staff attendance and tasks are available only to staff accounts' });
    }
    return next();
}

router.use(requireAuth);
router.get('/me', asyncHandler(controller.myWorkspace));
router.post('/attendance/clock-in', requireStaff, asyncHandler(controller.clockIn));
router.post('/attendance/clock-out', requireStaff, asyncHandler(controller.clockOut));
router.post('/tasks', requirePermission('HR_CREATE'), asyncHandler(controller.createTask));
router.post('/tasks/:businessId/start', requireStaff, asyncHandler(controller.startTask));
router.post('/tasks/:businessId/stop', requireStaff, asyncHandler(controller.stopTask));
router.put('/tasks/:businessId', asyncHandler(controller.updateTask));
router.post('/tasks/:businessId/reports', asyncHandler(controller.submitTaskReport));
router.get('/tasks/:businessId/reports', requirePermission('HR_VIEW'), asyncHandler(controller.taskReportHistory));
router.get('/team', requirePermission('HR_VIEW'), asyncHandler(controller.teamOverview));

module.exports = router;
