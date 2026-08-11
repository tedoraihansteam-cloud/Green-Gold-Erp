const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const employeeController = require('../controllers/employeeController');

const router = express.Router();
router.use(requireAuth);

router.get('/', requirePermission('HR_VIEW'), asyncHandler(employeeController.listEmployees));
router.post('/', requirePermission('HR_CREATE'), asyncHandler(employeeController.createEmployee));
router.get('/:businessId', requirePermission('HR_VIEW'), asyncHandler(employeeController.getEmployee));
router.put('/:businessId', requirePermission('HR_EDIT'), asyncHandler(employeeController.updateEmployee));

module.exports = router;
