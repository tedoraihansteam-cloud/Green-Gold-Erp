const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const verifyController = require('../controllers/verifyController');

const router = express.Router();
router.use(requireAuth);

router.post('/', requirePermission('SECURITY_VIEW'), asyncHandler(verifyController.verify));

module.exports = router;
