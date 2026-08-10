const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const c = require('../controllers/logisticsController');

const router = express.Router();
router.use(requireAuth);

router.get('/vehicles', requirePermission('LOGISTICS_VIEW'), asyncHandler(c.listVehicles));
router.post('/vehicles', requirePermission('LOGISTICS_CREATE'), asyncHandler(c.createVehicle));

router.get('/deliveries', requirePermission('LOGISTICS_VIEW'), asyncHandler(c.listDeliveries));
router.post('/deliveries', requirePermission('LOGISTICS_CREATE'), asyncHandler(c.createDelivery));
router.post('/deliveries/:businessId/dispatch', requirePermission('LOGISTICS_EDIT'), asyncHandler(c.dispatchDelivery));
router.post('/deliveries/:businessId/complete', requirePermission('LOGISTICS_EDIT'), asyncHandler(c.completeDelivery));
router.post('/deliveries/:businessId/fail', requirePermission('LOGISTICS_EDIT'), asyncHandler(c.failDelivery));

module.exports = router;
