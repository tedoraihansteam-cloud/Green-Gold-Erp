import { useState } from 'react';
import { api } from '../lib/apiClient';
import { EntityDocumentActions } from './DocumentActions';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
const CORRECTABLE=new Set(['CUSTOMER','VENDOR','PRODUCT','WAREHOUSE','EMPLOYEE','MACHINE','VEHICLE','STORAGE_LOCATION','PURCHASE_REQUISITION','PORTAL_REQUEST','BILL_SUBMISSION','PURCHASE_ORDER','SALES_INVOICE','FINANCIAL_INVOICE','ACCOUNT_TRANSACTION','PAYROLL','GOODS_RECEIPT','DELIVERY','GATE_PASS','CUSTOMER_PAYMENT']);

export default function BusinessIdentifier({ entityType, businessId, children }) {
    const {can}=useAuth();
    const [open, setOpen] = useState(false);
    const [codes, setCodes] = useState(null);
    const [error, setError] = useState('');

    const toggle = async () => {
        const next = !open;
        setOpen(next);
        if (next && !codes) {
            try {
                setError('');
                setCodes(await api.get(`/identifiers/${entityType}/${encodeURIComponent(businessId)}`));
            } catch (err) {
                setError(err.message);
            }
        }
    };

    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            {children || <span className="mono">{businessId}</span>}
            <button type="button" className="btn btn-secondary btn-sm" onClick={toggle} aria-expanded={open}>
                {open ? 'Hide codes' : 'QR / barcode'}
            </button>
            {open && (
                <span style={{ flexBasis: '100%', display: 'flex', gap: 12, alignItems: 'center', padding: 10, background: 'white', border: '1px solid var(--ink-200)', borderRadius: 8 }}>
                    {error && <span className="error-banner">{error}</span>}
                    {!error && !codes && <span>Loading…</span>}
                    {codes && <>
                        <a href={codes.qrUrl} target="_blank" rel="noreferrer"><img src={codes.qrUrl} alt={`QR code for ${businessId}`} style={{ width: 110, height: 110 }} /></a>
                        <a href={codes.barcodeUrl} target="_blank" rel="noreferrer"><img src={codes.barcodeUrl} alt={`Barcode for ${businessId}`} style={{ maxWidth: 230, maxHeight: 90 }} /></a>
                        <EntityDocumentActions entityType={entityType} businessId={businessId} />
                        {can('USER_MANAGEMENT_EDIT')&&CORRECTABLE.has(entityType)&&<Link className="btn btn-secondary btn-sm" to={`/admin/data-corrections?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(businessId)}`}>Edit / delete / history</Link>}
                    </>}
                </span>
            )}
        </span>
    );
}
