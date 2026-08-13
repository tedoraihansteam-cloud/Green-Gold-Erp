const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const accountController = require('../controllers/accountController');

const router = express.Router();
router.use(requireAuth);

router.get('/', requirePermission('ACCOUNTS_VIEW'), asyncHandler(accountController.listAccounts));
router.post('/', requirePermission('ACCOUNTS_CREATE'), asyncHandler(accountController.createAccount));
router.put('/:businessId', requirePermission('ACCOUNTS_CREATE'), asyncHandler(accountController.updateAccount));
router.post('/controls/start-financial-operations', requirePermission('ACCOUNTS_APPROVE'), asyncHandler(accountController.startFinancialOperations));
router.get('/balance-sheet', requirePermission('ACCOUNTS_VIEW'), asyncHandler(accountController.dailyBalanceSheet));
router.get('/pending-actions', requirePermission('ACCOUNTS_VIEW'), asyncHandler(accountController.pendingFinancialActions));
router.get('/:businessId/statement', requirePermission('ACCOUNTS_VIEW'), asyncHandler(accountController.getAccountStatement));
router.post('/transfer', requirePermission('ACCOUNTS_CREATE'), asyncHandler(accountController.transferFunds));
router.get('/transfer-requests', requirePermission('ACCOUNTS_VIEW'), asyncHandler(accountController.listTransferRequests));
router.post('/transfer-requests/:businessId/review', requirePermission('ACCOUNTS_APPROVE'), asyncHandler(accountController.reviewTransferRequest));

module.exports = router;
