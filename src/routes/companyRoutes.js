const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const companyController = require('../controllers/companyController');

const router = express.Router();

router.get('/public-info', asyncHandler(companyController.publicInfo));

router.use(requireAuth);

router.get('/branches', asyncHandler(companyController.listBranches));
router.get('/sites',asyncHandler(companyController.listSites));
router.post('/branches', requirePermission('SETTINGS_CREATE'), asyncHandler(companyController.createBranch));
router.get('/departments', asyncHandler(companyController.listDepartments));
router.post('/departments', requirePermission('SETTINGS_CREATE'), asyncHandler(companyController.createDepartment));
router.get('/departments/:businessId',asyncHandler(companyController.departmentDetail));
router.put('/departments/:businessId',requirePermission('SETTINGS_CREATE'),asyncHandler(companyController.updateDepartment));
router.post('/departments/:businessId/assign-staff',requirePermission('HR_EDIT'),asyncHandler(companyController.assignStaff));

module.exports = router;
