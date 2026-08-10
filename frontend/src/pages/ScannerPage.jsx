import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { api } from '../lib/apiClient';

const LABELS = {
    business_id: 'ID', product_name: 'Product', product_business_id: 'Product ID', warehouse_name: 'Warehouse',
    warehouse_business_id: 'Warehouse ID', location_name: 'Location', location_business_id: 'Location ID',
    full_name: 'Name', contact_name: 'Contact', contact_phone: 'Phone', customer_name: 'Customer',
    received_quantity: 'Received quantity', available_quantity: 'Available quantity', stored_quantity: 'Stored quantity',
    batch_count: 'Batches stored', pass_type: 'Pass type', vehicle_number: 'Vehicle', created_at: 'Created'
};

function displayValue(key, value) {
    if (value == null || value === '') return '—';
    if (key.endsWith('_at')) return new Date(value).toLocaleString();
    if (Array.isArray(value)) return value.length ? value.map((item) => `${item.name || item.businessId}: ${item.quantity}`).join(', ') : 'None';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value).replace(/_/g, ' ');
}

export default function ScannerPage() {
    const navigate = useNavigate();
    const scannerRef = useRef(null);
    const workflowRef = useRef(null);
    const [value, setValue] = useState('');
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [scanning, setScanning] = useState(false);
    const [workflow, setWorkflow] = useState(null);
    const [manualOptions, setManualOptions] = useState([]);
    const [showManual, setShowManual] = useState(false);
    const [quantity, setQuantity] = useState('');
    const [message, setMessage] = useState('');
    const [exitNote, setExitNote] = useState('');
    const [submittingExit, setSubmittingExit] = useState(false);

    useEffect(() => { workflowRef.current = workflow; }, [workflow]);
    useEffect(() => () => { if (scannerRef.current?.isScanning) scannerRef.current.stop().catch(() => {}); }, []);

    const resolveCode = async (rawPayload) => api.post('/scan/resolve', { rawPayload });

    const acceptWorkflowScan = (scanned) => {
        const current = workflowRef.current;
        if (!current) return;
        if (current.kind === 'LOCATION_FIRST' && !['PRODUCT_BATCH', 'PRODUCT_UNIT'].includes(scanned.entityType)) {
            throw new Error('Please scan a product batch or unit code');
        }
        if (current.kind === 'BATCH_FIRST' && scanned.entityType !== 'STORAGE_LOCATION') {
            throw new Error('Please scan a storage location code');
        }
        setWorkflow((state) => current.kind === 'LOCATION_FIRST'
            ? { ...state, batchOrUnitBusinessId: scanned.businessId, scannedTarget: scanned }
            : { ...state, locationBusinessId: scanned.businessId, scannedTarget: scanned });
        if (scanned.entityType === 'PRODUCT_UNIT') setQuantity('1');
    };

    const startCamera = async (forWorkflow = false) => {
        try {
            setError(''); setMessage('');
            if (scannerRef.current?.isScanning) await scannerRef.current.stop();
            if (scannerRef.current) { try { await scannerRef.current.clear(); } catch {} }
            const scanner = new Html5Qrcode('qr-reader');
            scannerRef.current = scanner;
            setScanning(true);
            await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 250, height: 250 } }, async (text) => {
                await scanner.stop();
                try { await scanner.clear(); } catch {}
                setScanning(false);
                try {
                    const scanned = await resolveCode(text);
                    if (forWorkflow) acceptWorkflowScan(scanned);
                    else { setValue(text); setResult(scanned); setWorkflow(null); }
                } catch (err) { setError(err.message); }
            }, () => {});
        } catch (err) { setScanning(false); setError(`Camera scanner could not start: ${err.message || err}`); }
    };

    const resolveManualCode = async () => {
        try { setError(''); setWorkflow(null); setResult(await resolveCode(value)); }
        catch (err) { setError(err.message); setResult(null); }
    };

    const beginWorkflow = (kind, actionLabel) => {
        const next = kind === 'LOCATION_FIRST'
            ? { kind, actionLabel, locationBusinessId: result.businessId, batchOrUnitBusinessId: '' }
            : { kind, actionLabel, batchOrUnitBusinessId: result.businessId, locationBusinessId: '' };
        workflowRef.current = next;
        setWorkflow(next); setShowManual(false); setManualOptions([]); setQuantity(result.entityType === 'PRODUCT_UNIT' ? '1' : ''); setMessage(''); setError('');
        window.setTimeout(() => startCamera(true), 100);
    };

    const openManual = async () => {
        try {
            setError('');
            const response = workflow.kind === 'LOCATION_FIRST' ? await api.get('/inventory/batches') : await api.get('/inventory/locations');
            setManualOptions(workflow.kind === 'LOCATION_FIRST' ? response.batches || [] : response.locations || []);
            setShowManual(true);
        } catch (err) { setError(err.message); }
    };

    const confirmPlacement = async (event) => {
        event.preventDefault();
        try {
            setError(''); setMessage('');
            const response = await api.post('/scan/place-stock', {
                locationBusinessId: workflow.locationBusinessId,
                batchOrUnitBusinessId: workflow.batchOrUnitBusinessId,
                quantity: quantity ? Number(quantity) : undefined
            });
            setMessage(`${response.operation.replace(/_/g, ' ')} completed: ${response.quantity} from ${response.batchBusinessId}`);
            setWorkflow(null); setShowManual(false);
        } catch (err) { setError(err.message); }
    };

    const actionable = result?.actions?.filter((action) => action.code !== 'VIEW_INLINE') || [];
    const canConfirmExit = actionable.some((action) => action.code === 'CONFIRM_EXIT');
    const confirmGateExit = async (event) => {
        event.preventDefault(); setSubmittingExit(true); setError(''); setMessage('');
        try {
            const response = await api.post(`/security/gate-passes/${result.businessId}/confirm-exit`, { exitNote });
            setMessage(response.message || 'Exit confirmed and exit note submitted');
            setResult((current) => ({ ...current, record: response.gatePass, actions: current.actions.filter(action => action.code !== 'CONFIRM_EXIT') }));
            setExitNote('');
        } catch (err) { setError(err.message); } finally { setSubmittingExit(false); }
    };

    return <div>
        <div className="card-header" style={{ marginBottom: 18 }}><div><h1 className="page-title">Scan ERP identity</h1><p className="card-subtitle">Only the scanned product, person, place or document is shown.</p></div></div>
        <div className="card">
            <div id="qr-reader" style={{ maxWidth: 520, marginBottom: 16 }} />
            {!scanning && !workflow && <button type="button" className="btn btn-primary" onClick={() => startCamera(false)}>Start camera scanner</button>}
            {!workflow && <><div className="field" style={{ marginTop: 18 }}><label htmlFor="manualCode">Scanner/manual input</label><textarea id="manualCode" rows={3} value={value} onChange={(event) => setValue(event.target.value)} placeholder="Scan or enter one business ID" /></div><button type="button" className="btn btn-secondary" disabled={!value.trim()} onClick={resolveManualCode}>Find scanned record</button></>}
            {error && <div className="error-banner" style={{ marginTop: 14 }}>{error}</div>}
            {message && <div className="success-banner" style={{ marginTop: 14 }}>{message}</div>}
        </div>

        {result && !workflow && <div className="card">
            <div className="card-header"><div><h2>{result.entityType.replace(/_/g, ' ')}</h2><p className="mono">{result.businessId}</p></div><span className={`pill ${result.signed ? 'pill-success' : ''}`}>{result.signed ? 'Signed QR verified' : 'Barcode/ID matched'}</span></div>
            <div className="form-grid">
                {Object.entries(result.record || {}).filter(([key]) => key !== 'id').map(([key, recordValue]) => <div className="field" key={key}><label>{LABELS[key] || key.replace(/_/g, ' ')}</label><div>{displayValue(key, recordValue)}</div></div>)}
            </div>
            {canConfirmExit&&<form onSubmit={confirmGateExit} style={{marginTop:16}}><div className="field"><label htmlFor="gateExitNote">Exit remark / note</label><textarea id="gateExitNote" rows="3" value={exitNote} onChange={event=>setExitNote(event.target.value)} placeholder="Condition, quantity, vehicle, security observation or other exit remark" /></div><div className="form-actions" style={{justifyContent:'flex-start'}}><button disabled={submittingExit} className="btn btn-primary">{submittingExit?'Submitting…':'Exit & submit exit note'}</button></div></form>}
            {actionable.filter(action=>action.code!=='CONFIRM_EXIT').length > 0 && <div className="form-actions" style={{ justifyContent: 'flex-start' }}>{actionable.filter(action=>action.code!=='CONFIRM_EXIT').map((action) => <button key={action.code} type="button" className="btn btn-primary" onClick={() => {
                if (action.code === 'ADD_PRODUCT') beginWorkflow('LOCATION_FIRST', action.label);
                else if (['ADD_LOCATION', 'TRANSFER'].includes(action.code)) beginWorkflow('BATCH_FIRST', action.label);
                else if (action.route) navigate(action.route);
            }}>{action.label}</button>)}</div>}
        </div>}

        {workflow && <div className="card">
            <div className="card-header"><div><h2>{workflow.actionLabel}</h2><p className="card-subtitle">{workflow.kind === 'LOCATION_FIRST' ? `Location ${workflow.locationBusinessId}: scan the batch or unit to receive.` : `Batch/unit ${workflow.batchOrUnitBusinessId}: scan the destination location.`}</p></div></div>
            {!scanning && !workflow.scannedTarget && <button type="button" className="btn btn-primary" onClick={() => startCamera(true)}>Scan again</button>}
            <button type="button" className="btn btn-secondary" style={{ marginLeft: 8 }} onClick={openManual}>{workflow.kind === 'LOCATION_FIRST' ? 'Receive manually' : 'Select location manually'}</button>
            {showManual && <div className="field" style={{ marginTop: 14 }}><label>{workflow.kind === 'LOCATION_FIRST' ? 'Batch' : 'Location'}</label><select value={workflow.kind === 'LOCATION_FIRST' ? workflow.batchOrUnitBusinessId : workflow.locationBusinessId} onChange={(event) => setWorkflow((state) => workflow.kind === 'LOCATION_FIRST' ? { ...state, batchOrUnitBusinessId: event.target.value } : { ...state, locationBusinessId: event.target.value })}><option value="">Select…</option>{manualOptions.map((option) => <option key={option.id} value={option.business_id}>{workflow.kind === 'LOCATION_FIRST' ? `${option.business_id} — ${option.product_name}` : `${option.business_id} — ${option.name}`}</option>)}</select></div>}
            {workflow.batchOrUnitBusinessId && workflow.locationBusinessId && <form onSubmit={confirmPlacement}><div className="field" style={{ marginTop: 14, maxWidth: 280 }}><label>Quantity {workflow.batchOrUnitBusinessId.includes('-U') ? '(unit scan uses 1)' : '*'}</label><input type="number" min="0.001" step="0.001" required={!workflow.batchOrUnitBusinessId.includes('-U')} disabled={workflow.batchOrUnitBusinessId.includes('-U')} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div><div className="form-actions"><button type="button" className="btn btn-secondary" onClick={() => setWorkflow(null)}>Cancel</button><button className="btn btn-primary">Confirm {workflow.actionLabel.toLowerCase()}</button></div></form>}
        </div>}
    </div>;
}
