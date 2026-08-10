import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import Pill from '../../components/Pill';
import { IconPlus } from '../../components/Icons';
import BusinessIdentifier from '../../components/BusinessIdentifier';

export default function DeliveriesPage() {
    const { can } = useAuth();
    const { data, loading, error, reload } = useApi('/logistics/deliveries');
    const { data: invData } = useApi('/sales/invoices');
    const { data: vehData } = useApi('/logistics/vehicles');

    const [showCreate, setShowCreate] = useState(false);
    const [createForm, setCreateForm] = useState({ invoiceBusinessId: '', deliveryAddress: '', scheduledDate: '' });
    const [dispatching, setDispatching] = useState(null);
    const [vehicleChoice, setVehicleChoice] = useState('');
    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);

    const deliveries = data?.deliveries || [];
    const issuedInvoices = (invData?.invoices || []).filter((i) => i.status === 'issued');
    const availableVehicles = (vehData?.vehicles || []).filter((v) => v.status === 'available');

    const handleCreate = async (e) => {
        e.preventDefault();
        setBusy(true); setFormError('');
        try {
            await api.post('/logistics/deliveries', createForm);
            setShowCreate(false);
            setCreateForm({ invoiceBusinessId: '', deliveryAddress: '', scheduledDate: '' });
            reload();
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    const dispatch = async () => {
        setBusy(true); setFormError('');
        try {
            await api.post(`/logistics/deliveries/${dispatching.business_id}/dispatch`, { vehicleBusinessId: vehicleChoice });
            setDispatching(null); setVehicleChoice('');
            reload();
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    const complete = async (businessId) => {
        const proofNotes = prompt('Proof of delivery (received by, condition, etc.)?') || '';
        try { await api.post(`/logistics/deliveries/${businessId}/complete`, { proofNotes }); reload(); } catch (err) { alert(err.message); }
    };

    const fail = async (businessId) => {
        const reason = prompt('Reason the delivery failed?') || '';
        try { await api.post(`/logistics/deliveries/${businessId}/fail`, { reason }); reload(); } catch (err) { alert(err.message); }
    };

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">Deliveries</h1>
                    <p className="card-subtitle">Created from an issued invoice, dispatched with an available vehicle</p>
                </div>
                {can('LOGISTICS_CREATE') && <button type="button" className="btn btn-primary" onClick={() => { setFormError(''); setShowCreate(true); }}><IconPlus /> New delivery</button>}
            </div>

            <div className="card">
                {error && <div className="error-banner">{error}</div>}
                {loading ? <p style={{ color: 'var(--ink-600)' }}>Loading…</p> : (
                    <DataTable
                        columns={[
                            { key: 'business_id', label: 'ID', render: (r) => <BusinessIdentifier entityType="DELIVERY" businessId={r.business_id} /> },
                            { key: 'customer_name', label: 'Customer' },
                            { key: 'invoice_business_id', label: 'Invoice', render: (r) => r.invoice_business_id ? <BusinessIdentifier entityType="INVOICE" businessId={r.invoice_business_id} /> : '—' },
                            { key: 'vehicle_number', label: 'Vehicle', render: (r) => r.vehicle_number || '—' },
                            { key: 'status', label: 'Status', render: (r) => <Pill status={r.status} /> },
                            { key: 'actions', label: '', render: (r) => (
                                <div style={{ display: 'flex', gap: 6 }}>
                                    {r.status === 'scheduled' && can('LOGISTICS_EDIT') && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDispatching(r)}>Dispatch</button>}
                                    {r.status === 'in_transit' && can('LOGISTICS_EDIT') && <button type="button" className="btn btn-secondary btn-sm" onClick={() => complete(r.business_id)}>Complete</button>}
                                    {['scheduled', 'in_transit'].includes(r.status) && can('LOGISTICS_EDIT') && <button type="button" className="btn btn-danger btn-sm" onClick={() => fail(r.business_id)}>Fail</button>}
                                </div>
                            )}
                        ]}
                        rows={deliveries}
                        emptyMessage="No deliveries yet."
                    />
                )}
            </div>

            {showCreate && (
                <Modal title="New delivery" onClose={() => setShowCreate(false)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={handleCreate}>
                        <div className="field">
                            <label htmlFor="delInvoice">Invoice *</label>
                            <select id="delInvoice" required value={createForm.invoiceBusinessId} onChange={(e) => setCreateForm((s) => ({ ...s, invoiceBusinessId: e.target.value }))}>
                                <option value="">Select an issued invoice…</option>
                                {issuedInvoices.map((i) => <option key={i.id} value={i.business_id}>{i.business_id} — {i.customer_name}</option>)}
                            </select>
                        </div>
                        <div className="field"><label htmlFor="delAddress">Delivery address</label><input id="delAddress" value={createForm.deliveryAddress} onChange={(e) => setCreateForm((s) => ({ ...s, deliveryAddress: e.target.value }))} /></div>
                        <div className="field"><label htmlFor="delDate">Scheduled date</label><input id="delDate" type="date" value={createForm.scheduledDate} onChange={(e) => setCreateForm((s) => ({ ...s, scheduledDate: e.target.value }))} /></div>
                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
                        </div>
                    </form>
                </Modal>
            )}

            {dispatching && (
                <Modal title={`Dispatch ${dispatching.business_id}`} onClose={() => setDispatching(null)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <div className="field">
                        <label htmlFor="dispVehicle">Vehicle *</label>
                        <select id="dispVehicle" value={vehicleChoice} onChange={(e) => setVehicleChoice(e.target.value)}>
                            <option value="">Select an available vehicle…</option>
                            {availableVehicles.map((v) => <option key={v.id} value={v.business_id}>{v.vehicle_number} ({v.driver_name})</option>)}
                        </select>
                        {availableVehicles.length === 0 && <div className="hint">No vehicles are currently available.</div>}
                    </div>
                    <div className="form-actions">
                        <button type="button" className="btn btn-secondary" onClick={() => setDispatching(null)}>Cancel</button>
                        <button type="button" className="btn btn-primary" disabled={!vehicleChoice || busy} onClick={dispatch}>{busy ? 'Dispatching…' : 'Dispatch'}</button>
                    </div>
                </Modal>
            )}
        </div>
    );
}
