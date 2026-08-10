const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, requireAnyOf } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const payrollController = require('../controllers/payrollController');

const router = express.Router();
router.use(requireAuth);

router.get('/salary-templates', requirePermission('HR_VIEW'), asyncHandler(payrollController.listSalaryTemplates));
router.post('/salary-templates', requirePermission('HR_CREATE'), asyncHandler(payrollController.createSalaryTemplate));

router.get('/employees/:employeeBusinessId/salary-history', requirePermission('HR_VIEW'), asyncHandler(payrollController.getEmployeeSalaryHistory));
router.post('/employees/:employeeBusinessId/salary', requirePermission('HR_EDIT'), asyncHandler(payrollController.setEmployeeSalary));

router.get('/payroll-runs', requireAnyOf(['HR_VIEW','ACCOUNTS_VIEW']), asyncHandler(payrollController.listPayrollRuns));
router.post('/payroll-runs', requirePermission('HR_CREATE'), asyncHandler(payrollController.createPayrollRun));
router.get('/payroll-runs/:businessId', requireAnyOf(['HR_VIEW','ACCOUNTS_VIEW']), asyncHandler(payrollController.getPayrollRun));
router.put('/payroll-runs/:businessId/items/:employeeBusinessId', requirePermission('HR_EDIT'), asyncHandler(payrollController.updatePayrollItem));
router.post('/payroll-runs/:businessId/submit-pay-order', asyncHandler(payrollController.submitPayrollPayOrder));
router.post('/payroll-runs/:businessId/accounts-approve', asyncHandler(payrollController.approvePayrollPayOrder));
router.post('/payroll-runs/:businessId/process', requirePermission('ACCOUNTS_CREATE'), asyncHandler(payrollController.processPayrollRun));

module.exports = router;
