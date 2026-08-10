import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api, downloadApiFile } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { IconPlus } from '../../components/Icons';

export default function StockPage() {
    const { can } = useAuth();
    const { data, loading, error, reload } = useApi('/inventory/stock-balances');
    const { data: productsData } = useApi('/inventory/products');
    const { data: warehousesData } = useApi('/inventory/warehouses');
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ productId: '', warehouseId: '', quantity: '', referenceType: 'OPENING_BALANCE', notes: '' });
    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);
    const [asOf,setAsOf]=useState(new Date().toISOString().slice(0,10));

    const rows = data?.balances || [];
    const products = productsData?.products || [];
    const warehouses = warehousesData?.warehouses || [];

    const handleSubmit = async (e) => {
        e.preventDefault();
        setBusy(true);
        setFormError('');
        try {
            await api.post('/inventory/stock-in', { ...form, quantity: Number(form.quantity) });
            setShowForm(false);
            setForm({ productId: '', warehouseId: '', quantity: '', referenceType: 'OPENING_BALANCE', notes: '' });
            reload();
        } catch (err) {
            setFormError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">Stock balances</h1>
                    <p className="card-subtitle">Current quantity per product, per warehouse</p>
                </div>
                <div style={{display:'flex',gap:8,alignItems:'end'}}><div className="field" style={{margin:0}}><label>Report date</label><input type="date" value={asOf} onChange={e=>setAsOf(e.target.value)}/></div><button className="btn btn-secondary" onClick={()=>downloadApiFile(`/documents/reports/stock-balance.csv?asOf=${asOf}`,`stock-balance-${asOf}.csv`)}>Download Excel/CSV</button>{can('INVENTORY_CREATE') && (
                    <button type="button" className="btn btn-primary" onClick={() => setShowForm(true)}><IconPlus /> Stock in</button>
                )}</div>
            </div>

            <div className="card">
                {error && <div className="error-banner">{error}</div>}
                {loading ? <p style={{ color: 'var(--ink-600)' }}>Loading…</p> : (
                    <DataTable
                        columns={[
                            { key: 'product_business_id', label: 'Product', render: (r) => <><span className="mono">{r.product_business_id}</span><br /><span style={{ color: 'var(--ink-600)' }}>{r.product_name}</span></> },
                            { key: 'warehouse_name', label: 'Warehouse' },
                            { key: 'quantity', label: 'Quantity', align: 'right', render: (r) => <span className="num">{Number(r.quantity).toLocaleString()} {r.unit}</span> }
                        ]}
                        rows={rows}
                        keyField="product_id"
                        emptyMessage="No stock recorded yet."
                    />
                )}
            </div>

            {showForm && (
                <Modal title="Record incoming stock" onClose={() => setShowForm(false)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={handleSubmit}>
                        <div className="field">
                            <label htmlFor="productId">Product *</label>
                            <select id="productId" required value={form.productId} onChange={(e) => setForm((s) => ({ ...s, productId: e.target.value }))}>
                                <option value="">Select a product…</option>
                                {products.map((p) => <option key={p.id} value={p.id}>{p.business_id} — {p.name}</option>)}
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="warehouseId">Warehouse *</label>
                            <select id="warehouseId" required value={form.warehouseId} onChange={(e) => setForm((s) => ({ ...s, warehouseId: e.target.value }))}>
                                <option value="">Select a warehouse…</option>
                                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.business_id} — {w.name}</option>)}
                            </select>
                        </div>
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="quantity">Quantity *</label>
                                <input id="quantity" type="number" step="0.001" min="0.001" required value={form.quantity} onChange={(e) => setForm((s) => ({ ...s, quantity: e.target.value }))} />
                            </div>
                            <div className="field">
                                <label htmlFor="referenceType">Reason</label>
                                <select id="referenceType" value={form.referenceType} onChange={(e) => setForm((s) => ({ ...s, referenceType: e.target.value }))}>
                                    <option value="OPENING_BALANCE">Opening balance</option>
                                    <option value="PURCHASE">Purchase received</option>
                                    <option value="ADJUSTMENT">Adjustment</option>
                                </select>
                            </div>
                        </div>
                        <div className="field">
                            <label htmlFor="notes">Notes</label>
                            <input id="notes" value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} />
                        </div>
                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Record stock'}</button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    );
}
