const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const attachmentController = require('../controllers/attachmentController');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'storage', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Configurable per architecture rule #25 (file limits must not be
// hard-coded) - these defaults can be moved into a settings table once the
// Settings module exists; kept as constants here so Phase 1 is self-contained.
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${unique}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
    fileFilter: (req, file, cb) => {
        if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
            return cb(new Error(`File type ${file.mimetype} is not allowed`));
        }
        cb(null, true);
    }
});

const router = express.Router();
router.use(requireAuth);

router.post('/', upload.single('file'), asyncHandler(attachmentController.upload));
router.get('/download/:id', asyncHandler(attachmentController.download));
router.get('/:entityType/:entityId', asyncHandler(attachmentController.listForEntity));

module.exports = router;
