import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import Pill from '../../components/Pill';
import { EntityDocumentActions } from '../../components/DocumentActions';

export default function PurchaseOrderDetailPage() {
    const { businessId } = useParams();
    const { can } = useAuth();
    const { data, loading, error, reload } = useApi(`/procurement/purchase-orders/${businessId}`);
    const { data: paymentsData, reload: reloadPayments } = useApi(`/procurement/purchase-orders/${businessId}/payments`);
    const { data: accData } = useApi('/accounts');

    const [showReceive, setShowReceive] = useState(false);
    const [receiveQtys, setReceiveQtys] = useState({});
    const [deliveryNoteRef, setDeliveryNoteRef] = useState('');
    const [receiptMeta,setReceiptMeta]=useState({conditionStatus:'good',acceptedByName:'',inspectionNotes:'',serials:{}});
    const [showPayment, setShowPayment] = useState(false);
    const [paymentForm, setPaymentForm] = useState({ accountBusinessId: '', amount: '', paymentMethod: 'bank', reference: '' });
    const [actionError, setActionError] = useState('');
    const [busy, setBusy] = useState(false);

    const po = data?.purchaseOrder;
    const payments = paymentsData?.payments || [];
    const accounts = accData?.accounts || [];
    const balanceDue = po ? Number(po.total) - Number(po.amount_paid) : 0;
    const outstandingItems = (po?.items || []).filter((i) => Number(i.quantity_received) < Number(i.quantity_ordered));

    const openReceive = () => {
        setReceiveQtys(Object.fromEntries(outstandingItems.map((i) => [i.id, ''])));
        setDeliveryNoteRef('');
        setActionError('');
        setShowReceive(true);
    };

    const submitReceive = async (e) => {
        e.preventDefault();
        setBusy(true); setActionError('');
        try {
            const items = Object.entries(receiveQtys)
                .filter(([, qty]) => qty && Number(qty) > 0)
                .map(([poItemId,qty])=>({poItemId,quantity:Number(qty),serialNumbers:(receiptMeta.serials[poItemId]||'').split(',').map(x=>x.trim()).filter(Boolean),conditionStatus:receiptMeta.conditionStatus}));
            if (items.length === 0) throw new Error('Enter a quantity for at least one item');
            await api.post(`/procurement/purchase-orders/${businessId}/receive`, {items,deliveryNoteRef,...receiptMeta});
            setShowReceive(false);
            reload();
        } catch (err) { setActionError(err.message); } finally { setBusy(false); }
    };

    const openPayment = () => {
        setPaymentForm({ accountBusinessId: '', amount: balanceDue.toFixed(2), paymentMethod: 'bank', reference: '' });
        setActionError('');
        setShowPayment(true);
    };

    const submitPayment = async (e) => {
        e.preventDefault();
        setBusy(true); setActionError('');
        try {
            await api.post(`/procurement/purchase-orders/${businessId}/payments`, paymentForm);
            setShowPayment(false);
            reload();
            reloadPayments();
        } catch (err) { setActionError(err.message); } finally { setBusy(false); }
    };

    const cancelPO = async () => {
        const reason = prompt('Reason for cancelling this purchase order?') || '';
        try {
            await api.post(`/procurement/purchase-orders/${businessId}/cancel`, { reason });
            reload();
        } catch (err) { alert(err.message); }
    };

    if (loading) return <p style={{ color: 'var(--ink-600)' }}>Loading…</p>;
    if (error) return <div className="error-banner">{error}</div>;
    if (!po) return null;

    return (
        <div>
            <Link to="/procurement/purchase-orders" className="breadcrumb-link">← All purchase orders</Link>
            <div className="card-header" style={{ marginTop: 8, marginBottom: 18 }}>
                <div>
                    <h1 className="page-title mono" style={{ fontFamily: 'var(--font-data)' }}>{po.business_id}</h1>
                    <p className="card-subtitle"><Link to={`/vendors/${po.vendor_business_id}`}>{po.vendor_name} ({po.vendor_business_id})</Link> — receiving at {po.destination_name||po.warehouse_business_id}</p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <EntityDocumentActions entityType="PURCHASE_ORDER" businessId={po.business_id}/>
                    <Pill status={po.status} />
                    <Pill status={po.payment_status} />
                    {['issued','partially_received'].includes(po.status) && ['INVENTORY_CREATE','COLD_STORAGE_CREATE','MANUFACTURING_CREATE','LOGISTICS_CREATE','USER_MANAGEMENT_APPROVE'].some(can) && (
                        <button type="button" className="btn btn-secondary" onClick={openReceive}>Receive goods</button>
                    )}
                    {po.status !== 'cancelled' && balanceDue > 0 && can('ACCOUNTS_CREATE') && (
                        <button type="button" className="btn btn-primary" onClick={openPayment}>Pay vendor</button>
                    )}
                    {po.status === 'issued' && Number(po.amount_paid) === 0 && can('INVENTORY_EDIT') && (
                        <button type="button" className="btn btn-danger" onClick={cancelPO}>Cancel</button>
                    )}
                </div>
            </div>

            {actionError && <div className="error-banner">{actionError}</div>}

            <div className="card">
                <div className="card-header"><h2>Line items</h2></div>
                <DataTable
                    columns={[
                        { key: 'product_business_id', label: 'Product', render: (r) => <><span className="mono">{r.product_business_id}</span> — {r.product_name}</> },
                        { key: 'quantity_ordered', label: 'Ordered', align: 'right', render: (r) => <span className="num">{Number(r.quantity_ordered).toLocaleString()} {r.unit}</span> },
                        { key: 'quantity_received', label: 'Received', align: 'right', render: (r) => <span className="num">{Number(r.quantity_received).toLocaleString()} {r.unit}</span> },
                        { key: 'unit_price', label: 'Unit cost', align: 'right', render: (r) => <span className="num">৳{Number(r.unit_price).toLocaleString()}</span> },
                        { key: 'line_total', label: 'Line total', align: 'right', render: (r) => <span className="num">৳{Number(r.line_total).toLocaleString()}</span> }
                    ]}
                    rows={po.items || []}
                />
                <div className="totals-box" style={{ marginTop: 16 }}>
                    <div className="row"><span>Subtotal</span><span className="num">৳{Number(po.subtotal).toLocaleString()}</span></div>
                    <div className="row"><span>Tax</span><span className="num">+ ৳{Number(po.tax).toLocaleString()}</span></div>
                    <div className="row total"><span>Total</span><span className="num">৳{Number(po.total).toLocaleString()}</span></div>
                    <div className="row"><span>Paid</span><span className="num" style={{ color: 'var(--moss-600)' }}>৳{Number(po.amount_paid).toLocaleString()}</span></div>
                    {balanceDue > 0 && <div className="row"><span>Balance due</span><span className="num" style={{ color: 'var(--rust-600)', fontWeight: 700 }}>৳{balanceDue.toLocaleString()}</span></div>}
                </div>
            </div>

            {payments.length > 0 && (
                <div className="card">
                    <div className="card-header"><h2>Payment history</h2></div>
                    <DataTable
                        columns={[
                            { key: 'payment_date', label: 'Date', render: (r) => new Date(r.payment_date).toLocaleDateString() },
                            { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="num">৳{Number(r.amount).toLocaleString()}</span> },
                            { key: 'payment_method', label: 'Method', render: (r) => r.payment_method.replace(/_/g, ' ') },
                            { key: 'account_name', label: 'Paid from' },
                            { key: 'reference', label: 'Reference' }
                        ]}
                        rows={payments}
                    />
                </div>
            )}

            {po.receipts && po.receipts.length > 0 && (
                <div className="card">
                    <div className="card-header"><h2>Receipt history</h2></div>
                    <DataTable
                        columns={[
                            { key: 'received_at', label: 'Date', render: (r) => new Date(r.received_at).toLocaleString() },
                            { key: 'received_by_username', label: 'Received by' },
                            { key: 'delivery_note_ref', label: 'Delivery note' }
                        ]}
                        rows={po.receipts}
                    />
                </div>
            )}

            {showReceive && (
                <Modal title="Receive goods" onClose={() => setShowReceive(false)}>
                    {actionError && <div className="error-banner">{actionError}</div>}
                    <form onSubmit={submitReceive}>
                        <p className="card-subtitle" style={{ marginBottom: 14 }}>Enter what actually arrived. Leave blank for items not in this shipment.</p>
                        {outstandingItems.map((item) => (
                            <div className="field" key={item.id}>
                                <label htmlFor={`recv-${item.id}`}>{item.product_name} — outstanding: {Number(item.quantity_ordered) - Number(item.quantity_received)} {item.unit}</label>
                                <input
                                    id={`recv-${item.id}`} type="number" step="0.001" min="0"
                                    max={Number(item.quantity_ordered) - Number(item.quantity_received)}
                                    value={receiveQtys[item.id] || ''}
                                    onChange={(e) => setReceiveQtys((s) => ({ ...s, [item.id]: e.target.value }))}
                                />
                                {item.receiving_action==='ASSET'&&<input placeholder="Serial numbers separated by commas" value={receiptMeta.serials[item.id]||''} onChange={e=>setReceiptMeta(x=>({...x,serials:{...x.serials,[item.id]:e.target.value}}))}/>}<small>{String(item.receiving_action||'STOCK').replaceAll('_',' ')}</small>
                            </div>
                        ))}
                        <div className="field">
                            <label htmlFor="deliveryNote">Delivery note reference</label>
                            <input id="deliveryNote" value={deliveryNoteRef} onChange={(e) => setDeliveryNoteRef(e.target.value)} />
                        </div>
                        <div className="form-actions">
                            <div className="field"><label>Condition</label><select value={receiptMeta.conditionStatus} onChange={e=>setReceiptMeta({...receiptMeta,conditionStatus:e.target.value})}><option>good</option><option>damaged</option><option>partial</option><option>rejected</option></select></div><div className="field"><label>Accepted by</label><input value={receiptMeta.acceptedByName} onChange={e=>setReceiptMeta({...receiptMeta,acceptedByName:e.target.value})}/></div><div className="field"><label>Inspection / completion notes</label><textarea value={receiptMeta.inspectionNotes} onChange={e=>setReceiptMeta({...receiptMeta,inspectionNotes:e.target.value})}/></div>
                            <button type="button" className="btn btn-secondary" onClick={() => setShowReceive(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Recording…' : 'Record receipt'}</button>
                        </div>
                    </form>
                </Modal>
            )}

            {showPayment && (
                <Modal title="Pay vendor" onClose={() => setShowPayment(false)}>
                    {actionError && <div className="error-banner">{actionError}</div>}
                    <form onSubmit={submitPayment}>
                        <p className="card-subtitle" style={{ marginBottom: 14 }}>Balance due: ৳{balanceDue.toLocaleString()}</p>
                        <div className="field">
                            <label htmlFor="poPayAccount">Pay from *</label>
                            <select id="poPayAccount" required value={paymentForm.accountBusinessId} onChange={(e) => setPaymentForm((s) => ({ ...s, accountBusinessId: e.target.value }))}>
                                <option value="">Select an account…</option>
                                {accounts.map((a) => <option key={a.id} value={a.business_id}>{a.name} (৳{Number(a.current_balance).toLocaleString()})</option>)}
                            </select>
                        </div>
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="poPayAmount">Amount (৳) *</label>
                                <input id="poPayAmount" type="number" step="0.01" min="0.01" max={balanceDue} required value={paymentForm.amount} onChange={(e) => setPaymentForm((s) => ({ ...s, amount: e.target.value }))} />
                            </div>
                            <div className="field">
                                <label htmlFor="poPayMethod">Method</label>
                                <select id="poPayMethod" value={paymentForm.paymentMethod} onChange={(e) => setPaymentForm((s) => ({ ...s, paymentMethod: e.target.value }))}>
                                    <option value="cash">Cash</option>
                                    <option value="bank">Bank transfer</option>
                                    <option value="mobile_banking">Mobile banking</option>
                                    <option value="cheque">Cheque</option>
                                </select>
                            </div>
                        </div>
                        <div className="field">
                            <label htmlFor="poPayRef">Reference (cheque no, transaction ID…)</label>
                            <input id="poPayRef" value={paymentForm.reference} onChange={(e) => setPaymentForm((s) => ({ ...s, reference: e.target.value }))} />
                        </div>
                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowPayment(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Recording…' : 'Record payment'}</button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    );
}
