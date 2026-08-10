const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAnyOf } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const c = require('../controllers/reportController');

const router = express.Router();
router.use(requireAuth);

router.get('/sales-summary',requireAnyOf(['SALES_VIEW','REPORTS_VIEW']), asyncHandler(c.salesSummary));
router.get('/inventory-status',requireAnyOf(['INVENTORY_VIEW','REPORTS_VIEW']), asyncHandler(c.inventoryStatus));
router.get('/financial-summary',requireAnyOf(['ACCOUNTS_VIEW','REPORTS_VIEW']), asyncHandler(c.financialSummary));
router.get('/cold-storage-occupancy',requireAnyOf(['COLD_STORAGE_VIEW','REPORTS_VIEW']), asyncHandler(c.coldStorageOccupancy));
router.get('/delivery-performance',requireAnyOf(['LOGISTICS_VIEW','REPORTS_VIEW']), asyncHandler(c.deliveryPerformance));
router.get('/customer-monthly/:customerBusinessId',requireAnyOf(['ACCOUNTS_VIEW','COLD_STORAGE_VIEW','SALES_VIEW','REPORTS_VIEW']), asyncHandler(c.customerMonthlyStatement));
router.get('/operational-daily',asyncHandler(c.operationalDaily));

module.exports = router;
