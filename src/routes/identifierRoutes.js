const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { getCodes, image } = require('../controllers/identifierController');

const router = express.Router();
router.get('/:entityType/:businessId', requireAuth, asyncHandler(getCodes));
router.get('/:entityType/:businessId/:kind(qr|barcode).png', requireAuth, asyncHandler(image));
module.exports = router;
