import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import Pill from '../../components/Pill';
import { IconPlus } from '../../components/Icons';
import BusinessIdentifier from '../../components/BusinessIdentifier';

export default function ContractsPage() {
    const { can } = useAuth();
    const { data, loading, error, reload } = useApi('/cold-storage/contracts');
    const { data: custData } = useApi('/customers');
    const { data: locData } = useApi('/cold-storage/locations');
    const { data: polData } = useApi('/cold-storage/rental-policies');

    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ customerBusinessId: '', storageLocationBusinessId: '', rentalPolicyBusinessId: '', unitQuantity: '', goodsDescription: '' });
    const [billingResult, setBillingResult] = useState(null);
    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);

    const contracts = data?.contracts || [];
    const customers = custData?.customers || [];
    const locations = locData?.locations || [];
    const policies = polData?.policies || [];

    const handleSubmit = async (e) => {
        e.preventDefault();
        setBusy(true); setFormError('');
        try {
            await api.post('/cold-storage/contracts', { ...form, unitQuantity: Number(form.unitQuantity) });
            setShowForm(false);
            setForm({ customerBusinessId: '', storageLocationBusinessId: '', rentalPolicyBusinessId: '', unitQuantity: '', goodsDescription: '' });
            reload();
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    const generateBilling = async (businessId) => {
        try {
            const res = await api.post(`/cold-storage/contracts/${businessId}/generate-billing`, {});
            setBillingResult(res.invoice);
            reload();
        } catch (err) { alert(err.message); }
    };

    const closeContract = async (businessId) => {
        if (!confirm(`Close contract ${businessId}?`)) return;
        await api.post(`/cold-storage/contracts/${businessId}/close`);
        reload();
    };

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">Storage contracts</h1>
                    <p className="card-subtitle">Rental billing runs automatically from product receiving through delivery.</p>
                </div>
                {can('COLD_STORAGE_CREATE') && <button type="button" className="btn btn-primary" onClick={() => { setFormError(''); setShowForm(true); }}><IconPlus /> New contract</button>}
            </div>

            <div className="card">
                {error && <div className="error-banner">{error}</div>}
                {loading ? <p style={{ color: 'var(--ink-600)' }}>Loading…</p> : (
                    <DataTable
                        columns={[
                            { key: 'business_id', label: 'ID', render: (r) => <BusinessIdentifier entityType="COLD_STORAGE_CONTRACT" businessId={r.business_id} /> },
                            { key: 'customer_name', label: 'Customer' },
                            { key: 'storage_location_name', label: 'Location' },
                            { key: 'rental_policy_name', label: 'Policy' },
                            { key: 'unit_quantity', label: 'Qty', align: 'right', render: (r) => <span className="num">{Number(r.unit_quantity).toLocaleString()}</span> },
                            { key: 'status', label: 'Status', render: (r) => <Pill status={r.status} /> },
                            { key: 'actions', label: '', render: (r) => r.status === 'active' && can('COLD_STORAGE_APPROVE') ? (
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <button type="button" className="btn btn-danger btn-sm" onClick={() => closeContract(r.business_id)}>Close</button>
                                </div>
                            ) : null }
                        ]}
                        rows={contracts}
                        emptyMessage="No storage contracts yet."
                    />
                )}
            </div>

            {showForm && (
                <Modal title="New storage contract" onClose={() => setShowForm(false)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={handleSubmit}>
                        <div className="field">
                            <label htmlFor="cCustomer">Customer *</label>
                            <select id="cCustomer" required value={form.customerBusinessId} onChange={(e) => setForm((s) => ({ ...s, customerBusinessId: e.target.value }))}>
                                <option value="">Select…</option>
                                {customers.map((c) => <option key={c.id} value={c.business_id}>{c.name}</option>)}
                            </select>
                        </div>
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="cLocation">Storage location *</label>
                                <select id="cLocation" required value={form.storageLocationBusinessId} onChange={(e) => setForm((s) => ({ ...s, storageLocationBusinessId: e.target.value }))}>
                                    <option value="">Select…</option>
                                    {locations.map((l) => <option key={l.id} value={l.business_id}>{l.location_type} — {l.name}</option>)}
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="cPolicy">Rental policy *</label>
                                <select id="cPolicy" required value={form.rentalPolicyBusinessId} onChange={(e) => setForm((s) => ({ ...s, rentalPolicyBusinessId: e.target.value }))}>
                                    <option value="">Select…</option>
                                    {policies.map((p) => <option key={p.id} value={p.business_id}>{p.name}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="cQty">Unit quantity *</label>
                                <input id="cQty" type="number" step="0.01" min="0.01" required value={form.unitQuantity} onChange={(e) => setForm((s) => ({ ...s, unitQuantity: e.target.value }))} />
                            </div>
                        </div>
                        <div className="field">
                            <label htmlFor="cGoods">Goods description</label>
                            <input id="cGoods" value={form.goodsDescription} onChange={(e) => setForm((s) => ({ ...s, goodsDescription: e.target.value }))} />
                        </div>
                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
                        </div>
                    </form>
                </Modal>
            )}

            {billingResult && (
                <Modal title="Billing generated" onClose={() => setBillingResult(null)}>
                    <div className="success-banner">Invoice <strong className="mono">{billingResult.business_id}</strong> created.</div>
                    <div className="totals-box" style={{ marginLeft: 0, width: '100%' }}>
                        <div className="row"><span>Period</span><span>{billingResult.billing_period_start} → {billingResult.billing_period_end}</span></div>
                        <div className="row"><span>Billed cycles</span><span>{billingResult.billed_cycles}{billingResult.minimum_applied ? ' (minimum applied)' : ''}</span></div>
                        <div className="row"><span>Subtotal</span><span className="num">৳{Number(billingResult.subtotal).toLocaleString()}</span></div>
                        <div className="row"><span>Tax</span><span className="num">৳{Number(billingResult.tax_amount).toLocaleString()}</span></div>
                        <div className="row total"><span>Total</span><span className="num">৳{Number(billingResult.total).toLocaleString()}</span></div>
                    </div>
                    <div className="form-actions"><button type="button" className="btn btn-primary" onClick={() => setBillingResult(null)}>Close</button></div>
                </Modal>
            )}
        </div>
    );
}
