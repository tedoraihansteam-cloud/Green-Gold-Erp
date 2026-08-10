const r=require('express').Router(),c=require('../controllers/financialControlController');
const {requireAuth}=require('../middleware/auth');const {requirePermission}=require('../middleware/rbac');const {asyncHandler}=require('../middleware/errorHandler');r.use(requireAuth);
r.get('/cost-centers',requirePermission('ACCOUNTS_VIEW'),asyncHandler(c.listCostCenters));r.post('/cost-centers',requirePermission('ACCOUNTS_CREATE'),asyncHandler(c.createCostCenter));
r.get('/reversals',requirePermission('ACCOUNTS_VIEW'),asyncHandler(c.listReversals));r.post('/reversals',requirePermission('ACCOUNTS_CREATE'),asyncHandler(c.requestReversal));r.post('/reversals/:businessId/review',requirePermission('ACCOUNTS_APPROVE'),asyncHandler(c.reviewReversal));
r.post('/refunds',requirePermission('ACCOUNTS_CREATE'),asyncHandler(c.createRefund));r.get('/ledgers/:partyType/:partyBusinessId',requirePermission('ACCOUNTS_VIEW'),asyncHandler(c.ledgers));module.exports=r;
