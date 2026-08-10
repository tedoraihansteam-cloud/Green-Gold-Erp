const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const gatePassController = require('../controllers/gatePassController');

const router = express.Router();
router.use(requireAuth);

router.get('/gate-passes', requirePermission('SECURITY_VIEW'), asyncHandler(gatePassController.listGatePasses));
router.get('/gate-passes/:businessId', requirePermission('SECURITY_VIEW'), asyncHandler(gatePassController.getGatePass));
router.post('/gate-passes/from-invoice/:invoiceBusinessId', requirePermission('SECURITY_CREATE'), asyncHandler(gatePassController.createFromInvoice));
router.post('/gate-passes', requirePermission('SECURITY_CREATE'), asyncHandler(gatePassController.createManual));
router.post('/gate-passes/:businessId/confirm-exit', requirePermission('SECURITY_APPROVE'), asyncHandler(gatePassController.confirmExit));
router.post('/gate-passes/:businessId/cancel', requirePermission('SECURITY_APPROVE'), asyncHandler(gatePassController.cancelGatePass));

module.exports = router;
