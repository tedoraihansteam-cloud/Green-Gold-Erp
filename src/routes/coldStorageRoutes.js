const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, requireAnyOf } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const coldStorageController = require('../controllers/coldStorageController');

const router = express.Router();
router.use(requireAuth);

router.get('/locations', requireAnyOf(['COLD_STORAGE_VIEW','INVENTORY_VIEW']), asyncHandler(coldStorageController.listStorageLocations));
router.post('/locations', requirePermission('COLD_STORAGE_CREATE'), asyncHandler(coldStorageController.createStorageLocation));

router.get('/rental-policies', requirePermission('COLD_STORAGE_VIEW'), asyncHandler(coldStorageController.listRentalPolicies));
router.post('/rental-policies', requirePermission('COLD_STORAGE_CREATE'), asyncHandler(coldStorageController.createRentalPolicy));

router.get('/contracts', requireAnyOf(['COLD_STORAGE_VIEW','COLD_STORAGE_APPROVE']), asyncHandler(coldStorageController.listContracts));
router.post('/contracts', requirePermission('COLD_STORAGE_CREATE'), asyncHandler(coldStorageController.createContract));
router.post('/contracts/:businessId/generate-billing', requirePermission('COLD_STORAGE_APPROVE'), asyncHandler(coldStorageController.generateBilling));
router.post('/contracts/:businessId/close', requirePermission('COLD_STORAGE_APPROVE'), asyncHandler(coldStorageController.closeContract));
router.get('/charges', requirePermission('COLD_STORAGE_VIEW'), asyncHandler(coldStorageController.listLaborCharges));
router.post('/charges', requirePermission('COLD_STORAGE_CREATE'), asyncHandler(coldStorageController.createLaborCharge));

module.exports = router;
