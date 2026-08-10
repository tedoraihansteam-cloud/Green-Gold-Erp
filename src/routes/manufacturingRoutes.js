const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const c = require('../controllers/manufacturingController');

const router = express.Router();
router.use(requireAuth);

router.get('/machines', requirePermission('MANUFACTURING_VIEW'), asyncHandler(c.listMachines));
router.post('/machines', requirePermission('MANUFACTURING_CREATE'), asyncHandler(c.createMachine));

router.get('/shift-logs', requirePermission('MANUFACTURING_VIEW'), asyncHandler(c.listShiftLogs));
router.post('/shift-logs', requirePermission('MANUFACTURING_CREATE'), asyncHandler(c.logShift));
router.get('/shifts', requirePermission('MANUFACTURING_VIEW'), asyncHandler(c.listShifts));
router.put('/shifts', requirePermission('MANUFACTURING_APPROVE'), asyncHandler(c.configureShifts));
router.get('/shift-reports', requirePermission('MANUFACTURING_VIEW'), asyncHandler(c.listShiftReports));
router.post('/shift-reports', requirePermission('MANUFACTURING_CREATE'), asyncHandler(c.submitShiftReport));
router.get('/machines/:businessId/history', requirePermission('MANUFACTURING_VIEW'), asyncHandler(c.machineHistory));

router.get('/incidents', requirePermission('MANUFACTURING_VIEW'), asyncHandler(c.listIncidents));
router.post('/incidents', requirePermission('MANUFACTURING_CREATE'), asyncHandler(c.createIncident));
router.post('/incidents/:businessId/resolve', requirePermission('MANUFACTURING_APPROVE'), asyncHandler(c.resolveIncident));

router.get('/maintenance', requirePermission('MANUFACTURING_VIEW'), asyncHandler(c.listMaintenance));
router.post('/maintenance', requirePermission('MANUFACTURING_CREATE'), asyncHandler(c.scheduleMaintenance));
router.post('/maintenance/:id/complete', requirePermission('MANUFACTURING_EDIT'), asyncHandler(c.completeMaintenance));

module.exports = router;
