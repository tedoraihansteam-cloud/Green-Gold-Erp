const TOKEN_KEY = 'ggerp_token';

export function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
}

/**
 * Thin fetch wrapper: attaches the bearer token, parses JSON, and throws
 * an Error whose .message is the backend's own error string, so callers
 * can just show err.message directly without re-mapping status codes.
 */
async function request(path, { method = 'GET', body, isForm = false } = {}) {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
        const scope = JSON.parse(localStorage.getItem('ggerp:appearance') || '{}').operationalScopeId;
        if (scope) headers['X-Operational-Scope'] = scope;
    } catch { /* optional personal preference */ }
    if (body && !isForm) headers['Content-Type'] = 'application/json';

    const res = await fetch(`/api${path}`, {
        method,
        headers,
        body: body ? (isForm ? body : JSON.stringify(body)) : undefined
    });

    if (res.status === 401) {
        setToken(null);
        window.dispatchEvent(new Event('ggerp:unauthorized'));
    }

    let data = null;
    const text = await res.text();
    if (text) {
        try { data = JSON.parse(text); } catch { data = { error: text }; }
    }

    if (!res.ok) {
        throw new Error((data && data.error) || `Request failed (${res.status})`);
    }
    return data;
}

export const api = {
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body }),
    put: (path, body) => request(path, { method: 'PUT', body }),
    del: (path) => request(path, { method: 'DELETE' }),
    postForm: (path, formData) => request(path, { method: 'POST', body: formData, isForm: true })
};

export async function downloadApiFile(path, fallbackName, openForPrint = false) {
    // Open synchronously while the click event is still active; otherwise browsers
    // classify a window opened after the awaited fetch as an unsolicited popup.
    const printWindow = openForPrint ? window.open('', '_blank') : null;
    if (printWindow) {
        printWindow.document.title = fallbackName || 'Preparing document';
        printWindow.document.body.innerHTML = '<p style="font-family:sans-serif;padding:24px">Preparing printable document…</p>';
    }
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`/api${path}`, { headers });
    if (!response.ok) {
        if (printWindow) printWindow.close();
        let message = `Download failed (${response.status})`;
        try { message = (await response.json()).error || message; } catch { /* non-JSON error */ }
        throw new Error(message);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    if (openForPrint) {
        if (!printWindow) {
            URL.revokeObjectURL(url);
            throw new Error('The print window was blocked. Allow popups for this ERP and try again.');
        }
        printWindow.location.replace(url);
        setTimeout(() => URL.revokeObjectURL(url), 300000);
        return;
    }
    const link = document.createElement('a');
    link.href = url;
    const disposition = response.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    link.download = match?.[1] || fallbackName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoking immediately can cancel downloads before the browser has consumed
    // a large PDF/ZIP blob. Keep it briefly, then release it.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}
