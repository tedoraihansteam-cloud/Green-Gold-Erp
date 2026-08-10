const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const roleController = require('../controllers/roleController');

const router = express.Router();
router.use(requireAuth);

router.get('/permissions', requirePermission('USER_MANAGEMENT_VIEW'), asyncHandler(roleController.listPermissions));
router.get('/', requirePermission('USER_MANAGEMENT_VIEW'), asyncHandler(roleController.listRoles));
router.post('/', requirePermission('USER_MANAGEMENT_CREATE'), asyncHandler(roleController.createRole));
router.put('/:id/permissions', requirePermission('USER_MANAGEMENT_EDIT'), asyncHandler(roleController.setRolePermissions));

module.exports = router;
