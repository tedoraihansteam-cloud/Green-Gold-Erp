import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api and /files to the Express backend so the
// frontend can just call relative paths - no CORS juggling, and the
// built app works the same way if you ever serve it from the same
// origin as the API.
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            '/api': { target: 'http://localhost:4000', changeOrigin: true },
            '/files': { target: 'http://localhost:4000', changeOrigin: true }
        }
    }
});
