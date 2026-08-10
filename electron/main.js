const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const APP_URL = process.env.GGERP_URL || 'http://localhost:4000';
// /health only confirms Express itself is up - it never touches Postgres,
// so it can't be used to know the app is *actually* usable. This hits a
// real database-backed endpoint instead: any HTTP response (200 if a
// company is already set up, 404 if not) proves the full stack - server
// AND database - is reachable. Only a connection failure/timeout means
// genuinely not ready.
const READINESS_CHECK_URL = `${APP_URL}/api/org/public-info`;
const PROJECT_ROOT = path.join(__dirname, '..'); // this file lives in <project>/electron/
const BACKEND_ENTRY = path.join(PROJECT_ROOT, 'src', 'server.js');

let mainWindow = null;
let backendProcess = null;

function checkReady(url) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: 2000 }, (res) => {
            // 200 = company found, 404 = server+DB fine but nothing set up
            // yet - both prove the database call inside the handler
            // actually succeeded. A 500 means the handler's DB query
            // itself failed (e.g. Postgres unreachable) even though
            // Express responded - that's not ready yet.
            resolve(res.statusCode === 200 || res.statusCode === 404);
            res.resume();
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}

async function waitForBackend(maxAttempts, delayMs) {
    for (let i = 0; i < maxAttempts; i++) {
        if (await checkReady(READINESS_CHECK_URL)) return true;
        await new Promise((r) => setTimeout(r, delayMs));
    }
    return false;
}

/**
 * If nothing is answering at APP_URL yet, and this app is sitting inside
 * the full project (sibling to src/server.js - true when someone runs the
 * whole repo on one machine with Postgres already available locally or
 * via Docker), spawn the backend ourselves. This is the "one-click open"
 * behavior for the common case; when the backend runs elsewhere (a
 * separate server, or Docker on another host), APP_URL should just point
 * there instead and this spawn step is skipped since the file won't exist
 * in a standalone packaged build.
 */
function trySpawnLocalBackend() {
    if (backendProcess || !fs.existsSync(BACKEND_ENTRY)) return;
    backendProcess = spawn(process.execPath, [BACKEND_ENTRY], {
        cwd: PROJECT_ROOT,
        // process.execPath inside an Electron main process points to the
        // Electron binary itself, not plain Node - without this flag,
        // spawning it with a JS file would try to launch another Electron
        // GUI instance instead of running the backend as a plain script.
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: 'ignore'
    });
    backendProcess.on('exit', () => { backendProcess = null; });
}

function stopLocalBackend() {
    if (backendProcess) {
        backendProcess.kill();
        backendProcess = null;
    }
}

async function connectOrShowError() {
    if (!mainWindow) return;
    mainWindow.loadFile(path.join(__dirname, 'loading.html'));

    let ready = await waitForBackend(5, 1000); // quick check - maybe it's already running (Docker, etc.)

    if (!ready) {
        trySpawnLocalBackend();
        ready = await waitForBackend(25, 2000); // give a freshly-spawned backend + DB time to come up
    }

    if (!mainWindow) return; // window may have been closed while we were waiting

    if (ready) {
        mainWindow.loadURL(APP_URL);
    } else {
        mainWindow.loadFile(path.join(__dirname, 'connection-error.html'));
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1320,
        height: 840,
        minWidth: 980,
        minHeight: 620,
        title: 'Green Gold ERP',
        backgroundColor: '#14261B',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.on('closed', () => { mainWindow = null; });
    connectOrShowError();
}

ipcMain.handle('retry-connection', () => connectOrShowError());

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    stopLocalBackend();
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', stopLocalBackend);
