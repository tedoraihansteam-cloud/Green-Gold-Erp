const r = require('express').Router();
const c = require('../controllers/billController');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

function blockCustomerPortal(req, res, next) {
  if (req.user.account_type === 'customer') {
    return res.status(403).json({ error: 'Bill submission is not available in the customer portal' });
  }
  return next();
}

r.use(requireAuth, blockCustomerPortal);
r.get('/', asyncHandler(c.list));
r.post('/', asyncHandler(c.create));
r.get('/:businessId', asyncHandler(c.get));
r.put('/:businessId', asyncHandler(c.update));
r.post('/:businessId/submit', asyncHandler(c.submit));
r.post('/:businessId/review', asyncHandler(c.review));
r.post('/:businessId/pay', asyncHandler(c.pay));
r.post('/:businessId/accept', asyncHandler(c.accept));

module.exports = r;
