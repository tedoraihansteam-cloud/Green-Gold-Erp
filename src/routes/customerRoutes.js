const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const customerController = require('../controllers/customerController');

const router = express.Router();
router.use(requireAuth);

router.get('/', requirePermission('SALES_VIEW'), asyncHandler(customerController.listCustomers));
router.post('/', requirePermission('SALES_CREATE'), asyncHandler(customerController.createCustomer));
router.get('/:businessId', requirePermission('SALES_VIEW'), asyncHandler(customerController.getCustomer));
router.get('/:businessId/billing-context', requirePermission('SALES_VIEW'), asyncHandler(customerController.billingContext));

module.exports = router;
