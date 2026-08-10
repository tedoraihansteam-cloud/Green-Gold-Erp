const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { resolve } = require('../controllers/scanController');
const {placeStock}=require('../controllers/scanStockController');
const {requirePermission}=require('../middleware/rbac');
const router = express.Router();

function blockCustomerPortal(req, res, next) {
  if (req.user.account_type === 'customer') {
    return res.status(403).json({ error: 'QR and barcode scanning is available only to authorized operational staff' });
  }
  return next();
}

router.post('/resolve', requireAuth, blockCustomerPortal, asyncHandler(resolve));
router.post('/place-stock',requireAuth,requirePermission('INVENTORY_EDIT'),asyncHandler(placeStock));
module.exports = router;
