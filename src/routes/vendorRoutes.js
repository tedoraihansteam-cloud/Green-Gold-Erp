const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const vendorController = require('../controllers/vendorController');

const router = express.Router();
router.use(requireAuth);

router.get('/', requirePermission('INVENTORY_VIEW'), asyncHandler(vendorController.listVendors));
router.post('/', requirePermission('INVENTORY_CREATE'), asyncHandler(vendorController.createVendor));
router.get('/:businessId', requirePermission('INVENTORY_VIEW'), asyncHandler(vendorController.getVendor));

module.exports = router;
