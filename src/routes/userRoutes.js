const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const userController = require('../controllers/userController');

const router = express.Router();
router.use(requireAuth);

router.get('/me', asyncHandler(userController.getMyProfile));
router.put('/me', asyncHandler(userController.updateMyProfile));

router.get('/', requirePermission('USER_MANAGEMENT_VIEW'), asyncHandler(userController.listUsers));
router.post('/:id/roles', requirePermission('USER_MANAGEMENT_EDIT'), asyncHandler(userController.assignRole));
router.delete('/:id/roles/:roleId', requirePermission('USER_MANAGEMENT_EDIT'), asyncHandler(userController.removeRole));
router.post('/:id/disable', requirePermission('USER_MANAGEMENT_APPROVE'), asyncHandler(userController.disableUser));

module.exports = router;
