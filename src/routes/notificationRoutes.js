const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const notificationController = require('../controllers/notificationController');

const router = express.Router();

router.use(requireAuth);

router.get('/', asyncHandler(notificationController.listMine));
router.post('/', requirePermission('NOTICES_CREATE'), asyncHandler(notificationController.create));
router.post('/:id/read', asyncHandler(notificationController.markRead));
router.post('/:id/acknowledge', asyncHandler(notificationController.acknowledge));

module.exports = router;
