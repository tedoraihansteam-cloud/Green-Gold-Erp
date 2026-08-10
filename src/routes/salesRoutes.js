const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, requireAnyOf } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const salesController = require('../controllers/salesController');

const router = express.Router();
router.use(requireAuth);
router.get('/invoice-center', requireAnyOf(['SALES_VIEW','COLD_STORAGE_VIEW','INVENTORY_VIEW','LOGISTICS_VIEW','ACCOUNTS_VIEW']), asyncHandler(require('../controllers/invoiceCenterController').list));
router.get('/invoice-center/:businessId', requireAnyOf(['SALES_VIEW','COLD_STORAGE_VIEW','INVENTORY_VIEW','LOGISTICS_VIEW','ACCOUNTS_VIEW']), asyncHandler(require('../controllers/invoiceCenterController').detail));
router.post('/invoice-center/:businessId/review', requireAnyOf(['SALES_APPROVE','ACCOUNTS_APPROVE']), asyncHandler(require('../controllers/invoiceCenterController').review));
router.get('/rent-collection/context/:customerBusinessId', requireAnyOf(['COLD_STORAGE_VIEW','ACCOUNTS_VIEW']), asyncHandler(require('../controllers/invoiceCenterController').rentCollectionContext));
router.post('/rent-collection', requireAnyOf(['COLD_STORAGE_APPROVE','ACCOUNTS_CREATE']), asyncHandler(require('../controllers/invoiceCenterController').createRentCollection));

router.get('/invoices', requirePermission('SALES_VIEW'), asyncHandler(salesController.listInvoices));
router.post('/invoices', requirePermission('SALES_CREATE'), asyncHandler(salesController.createInvoice));
router.get('/invoices/:businessId', requirePermission('SALES_VIEW'), asyncHandler(salesController.getInvoice));
router.post('/invoices/:businessId/cancel', requirePermission('SALES_APPROVE'), asyncHandler(salesController.cancelInvoice));

module.exports = router;
