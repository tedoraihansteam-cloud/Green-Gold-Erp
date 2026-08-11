const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { requirePermission } = require('../middleware/rbac');
const c = require('../controllers/documentController');

const router = express.Router();
router.use(requireAuth);
router.get('/entity/:entityType/:businessId.pdf', asyncHandler(c.entityPdf));
router.get('/cards/:entityType/:businessId.pdf', asyncHandler(c.identityCardPdf));
router.get('/identifiers/batch.zip', asyncHandler(c.batchIdentifiers));
router.get('/reports/balance-sheet.:format(pdf|csv)', requirePermission('ACCOUNTS_VIEW'), asyncHandler(c.balanceSheetExport));
router.get('/reports/machine-logs.:format(pdf|csv)', requirePermission('MANUFACTURING_VIEW'), asyncHandler(c.machineLogsExport));
router.get('/reports/account-statement/:businessId.:format(pdf|csv)', requirePermission('ACCOUNTS_VIEW'), asyncHandler(c.accountStatementExport));
router.get('/labels/:kind.pdf', asyncHandler(c.labelSheet));
router.get('/reports/stock-balance.csv', requirePermission('INVENTORY_VIEW'), asyncHandler(c.stockBalanceExport));
router.get('/reports/customer-monthly/:customerBusinessId.:format(pdf|csv)', requirePermission('REPORTS_VIEW'), asyncHandler(c.customerMonthlyStatementExport));
router.get('/reports/daily-financial.:format(pdf|csv)', requirePermission('ACCOUNTS_VIEW'), asyncHandler(c.dailyFinancialReportExport));
module.exports = router;
