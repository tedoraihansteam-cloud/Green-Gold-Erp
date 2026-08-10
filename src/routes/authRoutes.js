const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const authController = require('../controllers/authController');

const router = express.Router();

// Auth endpoints are the most common brute-force target, so they get a
// tighter rate limit than the rest of the API.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.post('/register', authLimiter, asyncHandler(authController.register));
router.post('/login', authLimiter, asyncHandler(authController.login));
router.post('/forgot-password',authLimiter,asyncHandler(authController.requestPasswordReset));
router.get('/password-reset-requests',requireAuth,requirePermission('USER_MANAGEMENT_VIEW'),asyncHandler(authController.listPasswordResets));
router.post('/password-reset-requests/:businessId/review',requireAuth,requirePermission('USER_MANAGEMENT_APPROVE'),asyncHandler(authController.reviewPasswordReset));

router.get(
    '/link-requests',
    requireAuth,
    requirePermission('USER_MANAGEMENT_VIEW'),
    asyncHandler(authController.listPendingLinkRequests)
);
router.get('/pending-approvals', requireAuth, requirePermission('USER_MANAGEMENT_VIEW'), asyncHandler(authController.listPendingApprovals));
router.get('/pending-approvals/:userId/link-options', requireAuth, requirePermission('USER_MANAGEMENT_VIEW'), asyncHandler(authController.listApprovalLinkOptions));
router.post('/pending-approvals/:userId/review', requireAuth, requirePermission('USER_MANAGEMENT_APPROVE'), asyncHandler(authController.reviewPendingApproval));
router.post(
    '/link-requests/:id/review',
    requireAuth,
    requirePermission('USER_MANAGEMENT_APPROVE'),
    asyncHandler(authController.reviewLinkRequest)
);
router.post(
    '/users/:id/activate',
    requireAuth,
    requirePermission('USER_MANAGEMENT_APPROVE'),
    asyncHandler(authController.activateAccountDirectly)
);
router.post('/change-password', requireAuth, asyncHandler(authController.changePassword));
router.get('/me', requireAuth, asyncHandler(authController.me));

module.exports = router;
