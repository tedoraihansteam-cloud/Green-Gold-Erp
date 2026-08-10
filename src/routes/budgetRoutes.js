const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const budgetController = require('../controllers/budgetController');

const router = express.Router();
router.use(requireAuth);

router.get('/', requirePermission('BUDGET_VIEW'), asyncHandler(budgetController.listBudgets));
router.post('/', requirePermission('BUDGET_CREATE'), asyncHandler(budgetController.createBudget));

module.exports = router;
