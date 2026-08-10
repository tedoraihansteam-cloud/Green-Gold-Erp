import { useState } from 'react';
import { downloadApiFile } from '../lib/apiClient';

export function EntityDocumentActions({ entityType, businessId }) {
    const [error, setError] = useState('');
    const path = `/documents/entity/${entityType}/${encodeURIComponent(businessId)}.pdf`;
    const run = async (print) => {
        try { setError(''); await downloadApiFile(path, `${entityType}_${businessId}.pdf`, print); }
        catch (err) { setError(err.message); }
    };
    return <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => run(false)}>Download PDF</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => run(true)}>Print</button>
        {error && <span className="hint" style={{ color: 'var(--rust-600)' }}>{error}</span>}
    </span>;
}

export function BatchIdentifierDownload({ entityType, rows, idKey = 'business_id' }) {
    const [error, setError] = useState('');
    const download = async () => {
        const items = rows.filter((row) => row[idKey]).map((row) => `${entityType}:${row[idKey]}`).join(',');
        if (!items) return;
        try { setError(''); await downloadApiFile(`/documents/identifiers/batch.zip?items=${encodeURIComponent(items)}`, 'green-gold-identifiers.zip'); }
        catch (err) { setError(err.message); }
    };
    return <span><button type="button" className="btn btn-secondary" disabled={!rows.length} onClick={download}>Download all QR/barcodes</button>{error && <span className="error-banner">{error}</span>}</span>;
}

export function ReportDownloadActions({ basePath, name }) {
    const [path, query] = basePath.split('?');
    const exportPath = (format) => `${path}.${format}${query ? `?${query}` : ''}`;
    return <span style={{ display: 'inline-flex', gap: 6 }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadApiFile(exportPath('pdf'), `${name}.pdf`)}>PDF</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadApiFile(exportPath('csv'), `${name}.csv`)}>CSV</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadApiFile(exportPath('pdf'), `${name}.pdf`, true)}>Print</button>
    </span>;
}
