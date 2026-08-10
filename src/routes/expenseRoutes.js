const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const expenseController = require('../controllers/expenseController');

const router = express.Router();
router.use(requireAuth);

router.get('/categories', requirePermission('ACCOUNTS_VIEW'), asyncHandler(expenseController.listCategories));
router.post('/categories', requirePermission('ACCOUNTS_CREATE'), asyncHandler(expenseController.createCategory));

router.get('/', requirePermission('ACCOUNTS_VIEW'), asyncHandler(expenseController.listExpenses));
router.post('/', requirePermission('ACCOUNTS_CREATE'), asyncHandler(expenseController.createExpense));
router.post('/:businessId/approve', requirePermission('ACCOUNTS_APPROVE'), asyncHandler(expenseController.approveExpense));
router.post('/:businessId/reject', requirePermission('ACCOUNTS_APPROVE'), asyncHandler(expenseController.rejectExpense));

module.exports = router;
