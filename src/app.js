const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Generated QR/barcode images and uploaded files are served as static
// assets so the frontend can display or print them directly.
app.use('/files/qrcodes', express.static(path.join(__dirname, '..', 'storage', 'qrcodes')));
app.use('/files/barcodes', express.static(path.join(__dirname, '..', 'storage', 'barcodes')));

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api', require('./routes'));

// In production, serve the built frontend from the same server so the
// whole app is one process to run - `cd frontend && npm run build`
// produces this folder. In development, run the Vite dev server
// separately (npm run dev in frontend/) instead.
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/files')) return next();
        res.sendFile(path.join(frontendDist, 'index.html'));
    });
}

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

module.exports = app;
