const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const controller = require('../controllers/identityCardController');

const directory = path.join(__dirname, '..', '..', 'storage', 'profile-photos');
fs.mkdirSync(directory, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({ destination: directory, filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`) }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg','image/png','image/webp'].includes(file.mimetype))
});
const router = express.Router();
router.use(requireAuth);
router.post('/:entityType/:businessId/photo', upload.single('photo'), asyncHandler(controller.uploadPhoto));
module.exports = router;
