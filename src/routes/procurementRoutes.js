const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission,requireAnyOf } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const c = require('../controllers/procurementController');
const rq=require('../controllers/purchaseRequisitionController');

const router = express.Router();
router.use(requireAuth);
router.get('/requisitions',asyncHandler(rq.list));router.post('/requisitions',asyncHandler(rq.create));router.get('/requisitions/:businessId',asyncHandler(rq.detail));router.post('/requisitions/:businessId/review',asyncHandler(rq.review));router.get('/destinations',asyncHandler(rq.destinations));

router.get('/purchase-orders', requirePermission('INVENTORY_VIEW'), asyncHandler(c.listPurchaseOrders));
router.post('/purchase-orders', requirePermission('INVENTORY_CREATE'), asyncHandler(c.createPurchaseOrder));
router.get('/purchase-orders/:businessId', requirePermission('INVENTORY_VIEW'), asyncHandler(c.getPurchaseOrder));
router.post('/purchase-orders/:businessId/receive', requireAnyOf(['INVENTORY_CREATE','COLD_STORAGE_CREATE','MANUFACTURING_CREATE','LOGISTICS_CREATE','USER_MANAGEMENT_APPROVE']), asyncHandler(c.receiveGoods));
router.post('/purchase-orders/:businessId/cancel', requirePermission('INVENTORY_EDIT'), asyncHandler(c.cancelPurchaseOrder));
router.get('/purchase-orders/:businessId/payments', requirePermission('INVENTORY_VIEW'), asyncHandler(c.listPayments));
router.post('/purchase-orders/:businessId/payments', requirePermission('ACCOUNTS_CREATE'), asyncHandler(c.recordPayment));
router.post('/purchase-orders/:businessId/payments/:paymentId/accept', requirePermission('ACCOUNTS_CREATE'), asyncHandler(c.acceptPayment));
router.post('/purchase-orders/:businessId/payments/:paymentId/reconcile', requirePermission('ACCOUNTS_APPROVE'), asyncHandler(c.reconcilePayment));

module.exports = router;
