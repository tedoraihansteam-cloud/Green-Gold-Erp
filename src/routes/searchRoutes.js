const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { universalSearch } = require('../controllers/searchController');
router.get('/', requireAuth, asyncHandler(universalSearch));
module.exports = router;
