const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler } = require('../middleware/errorHandler');
const inventoryController = require('../controllers/inventoryController');
const batchController = require('../controllers/batchController');

const router = express.Router();
router.use(requireAuth);

router.get('/warehouses', requirePermission('INVENTORY_VIEW'), asyncHandler(inventoryController.listWarehouses));
router.post('/warehouses', requirePermission('INVENTORY_CREATE'), asyncHandler(inventoryController.createWarehouse));

router.get('/products', requirePermission('INVENTORY_VIEW'), asyncHandler(inventoryController.listProducts));
router.post('/products', requirePermission('INVENTORY_CREATE'), asyncHandler(inventoryController.createProduct));

router.get('/stock-balances', requirePermission('INVENTORY_VIEW'), asyncHandler(inventoryController.getStockBalances));
router.post('/stock-in', requirePermission('INVENTORY_CREATE'), asyncHandler(inventoryController.stockIn));
router.get('/batches', requirePermission('INVENTORY_VIEW'), asyncHandler(batchController.listBatches));
router.get('/locations', requirePermission('INVENTORY_VIEW'), asyncHandler(batchController.listInventoryLocations));
router.post('/batches', requirePermission('INVENTORY_CREATE'), asyncHandler(batchController.createBatch));
router.post('/batches/accrue-rent', requirePermission('ACCOUNTS_CREATE'), asyncHandler(batchController.accrueRent));
router.post('/batches/:businessId/locate', requirePermission('INVENTORY_EDIT'), asyncHandler(batchController.locateBatch));
router.post('/batches/:businessId/release', requirePermission('INVENTORY_EDIT'), asyncHandler(batchController.releaseBatch));
router.post('/batches/:businessId/move', requirePermission('INVENTORY_EDIT'), asyncHandler(batchController.moveBatch));
router.get('/locations/:businessId/contents', requirePermission('INVENTORY_VIEW'), asyncHandler(batchController.locationContents));
router.put('/locations/:businessId/categories', requirePermission('INVENTORY_EDIT'), asyncHandler(batchController.setLocationCategories));

module.exports = router;
