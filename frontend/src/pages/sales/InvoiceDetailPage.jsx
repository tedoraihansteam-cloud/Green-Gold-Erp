import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../../lib/useApi';
import { api, downloadApiFile } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import Pill from '../../components/Pill';
import BusinessIdentifier from '../../components/BusinessIdentifier';

export default function InvoiceDetailPage() {
    const { businessId } = useParams();
    const isFinancial=businessId.startsWith('FIN-');
    const { can } = useAuth();
    const navigate = useNavigate();
    const { data, loading, error, reload } = useApi(isFinancial?`/sales/invoice-center/${businessId}`:`/sales/invoices/${businessId}`);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');
    const [showGatePass, setShowGatePass] = useState(false);
    const [gatePassForm, setGatePassForm] = useState({ vehicleNumber: '', contactName: '', contactPhone: '' });
    const [gatePassResult, setGatePassResult] = useState(null);

    const invoice = data?.invoice;

    const handleCancel = async () => {
        if (!confirm(`Cancel invoice ${businessId}? Stock will be returned.`)) return;
        setBusy(true);
        setActionError('');
        try {
            await api.post(`/sales/invoices/${businessId}/cancel`, { reason: 'Cancelled from ERP UI' });
            reload();
        } catch (err) {
            setActionError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const handleGatePass = async (e) => {
        e.preventDefault();
        setBusy(true);
        setActionError('');
        try {
            const res = await api.post(`/security/gate-passes/from-invoice/${businessId}`, gatePassForm);
            setGatePassResult(res.gatePass);
        } catch (err) {
            setActionError(err.message);
        } finally {
            setBusy(false);
        }
    };

    if (loading) return <p style={{ color: 'var(--ink-600)' }}>Loading…</p>;
    if (error) return <div className="error-banner">{error}</div>;
    if (!invoice) return null;
    if(isFinancial)return <FinancialInvoiceDetail invoice={invoice} can={can} reload={reload}/>;

    return (
        <div>
            <Link to="/invoices" className="breadcrumb-link">← All invoices</Link>
            <div className="card-header" style={{ marginTop: 8, marginBottom: 18 }}>
                <div>
                    <h1 className="page-title" style={{ fontFamily: 'var(--font-data)' }}><BusinessIdentifier entityType="INVOICE" businessId={invoice.business_id} /></h1>
                    <p className="card-subtitle">{invoice.customer_name} ({invoice.customer_business_id})</p>
                    <p className="card-subtitle">Payment: {invoice.payment_status} · Due {invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : 'legacy'} · Outstanding ৳{Number(invoice.outstanding_amount || 0).toLocaleString()}</p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <Pill status={invoice.status} />
                    <button type="button" className="btn btn-primary" onClick={() => downloadApiFile(`/documents/entity/INVOICE/${invoice.business_id}.pdf`, `${invoice.business_id}.pdf`)}>Download invoice</button>
                    <button type="button" className="btn btn-secondary" onClick={() => downloadApiFile(`/documents/entity/INVOICE/${invoice.business_id}.pdf`, `${invoice.business_id}.pdf`, true)}>Print</button>
                    {invoice.status === 'issued' && can('SECURITY_CREATE') && (
                        <button type="button" className="btn btn-secondary" onClick={() => setShowGatePass(true)}>Generate gate pass</button>
                    )}
                    {invoice.status === 'issued' && can('SALES_APPROVE') && (
                        <button type="button" className="btn btn-danger" onClick={handleCancel} disabled={busy}>Cancel invoice</button>
                    )}
                </div>
            </div>

            {actionError && <div className="error-banner">{actionError}</div>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                <section className="card" style={{ borderTop: '4px solid var(--paddy-700)' }}><h2 style={{ fontWeight: 800 }}>BILL TO</h2><h3 style={{ fontSize: 18, marginBottom: 8 }}>{invoice.customer_name}</h3><div className="mono">{invoice.customer_business_id}</div><p>{invoice.customer_address || 'Address not provided'}</p><p>{invoice.customer_phone || 'Phone not provided'}{invoice.customer_email ? ` · ${invoice.customer_email}` : ''}</p><p className="hint">Customer type: {invoice.customer_type || 'Customer'}</p></section>
                <section className="card" style={{ borderTop: '4px solid var(--husk-600)' }}><h2>{invoice.company_name}</h2>{invoice.company_tagline && <p><em>{invoice.company_tagline}</em></p>}<p>{invoice.company_address || 'Company document address not configured'}</p><p>{invoice.company_phone || ''}{invoice.company_email ? ` · ${invoice.company_email}` : ''}</p><p>{invoice.company_website || ''}</p><p className="hint">{invoice.registration_number ? `Registration: ${invoice.registration_number}` : ''}{invoice.tax_number ? ` · Tax ID: ${invoice.tax_number}` : ''}</p></section>
            </div>

            <div className="card">
                <div className="card-header"><h2>Line items</h2></div>
                <DataTable
                    columns={[
                        { key: 'product_business_id', label: 'Product', render: (r) => <><span className="mono">{r.product_business_id}</span> — {r.product_name}</> },
                        { key: 'batch_business_id', label: 'Batch', render: (r) => r.batch_business_id ? <BusinessIdentifier entityType="PRODUCT_BATCH" businessId={r.batch_business_id}/> : 'Legacy/unbatched' },
                        { key: 'quantity', label: 'Qty', align: 'right', render: (r) => <span className="num">{Number(r.quantity).toLocaleString()}</span> },
                        { key: 'unit_price', label: 'Unit price', align: 'right', render: (r) => <span className="num">৳{Number(r.unit_price).toLocaleString()}</span> },
                        { key: 'line_total', label: 'Line total', align: 'right', render: (r) => <span className="num">৳{Number(r.line_total).toLocaleString()}</span> }
                    ]}
                    rows={invoice.items || []}
                />
                <div className="totals-box" style={{ marginTop: 16 }}>
                    <div className="row"><span>Subtotal</span><span className="num">৳{Number(invoice.subtotal).toLocaleString()}</span></div>
                    <div className="row"><span>Discount</span><span className="num">− ৳{Number(invoice.discount).toLocaleString()}</span></div>
                    <div className="row"><span>Tax</span><span className="num">+ ৳{Number(invoice.tax).toLocaleString()}</span></div>
                    <div className="row total"><span>Total</span><span className="num">৳{Number(invoice.total).toLocaleString()}</span></div>
                </div>
            </div>

            {showGatePass && (
                <Modal title="Generate outward gate pass" onClose={() => { setShowGatePass(false); setGatePassResult(null); }}>
                    {gatePassResult ? (
                        <div>
                            <div className="success-banner">
                                Gate pass <strong className="mono">{gatePassResult.business_id}</strong> created. Security can scan it at the gate to release the goods.
                            </div>
                            <div className="form-actions">
                                <button type="button" className="btn btn-primary" onClick={() => { setShowGatePass(false); setGatePassResult(null); navigate('/gate-passes'); }}>View gate passes</button>
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleGatePass}>
                            <p className="card-subtitle" style={{ marginBottom: 14 }}>Description and quantities are pulled automatically from this invoice.</p>
                            <div className="field">
                                <label htmlFor="vehicleNumber">Vehicle number</label>
                                <input id="vehicleNumber" value={gatePassForm.vehicleNumber} onChange={(e) => setGatePassForm((s) => ({ ...s, vehicleNumber: e.target.value }))} />
                            </div>
                            <div className="form-grid">
                                <div className="field">
                                    <label htmlFor="contactName">Driver name</label>
                                    <input id="contactName" value={gatePassForm.contactName} onChange={(e) => setGatePassForm((s) => ({ ...s, contactName: e.target.value }))} />
                                </div>
                                <div className="field">
                                    <label htmlFor="contactPhone">Driver phone</label>
                                    <input id="contactPhone" value={gatePassForm.contactPhone} onChange={(e) => setGatePassForm((s) => ({ ...s, contactPhone: e.target.value }))} />
                                </div>
                            </div>
                            <div className="form-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowGatePass(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Generate pass'}</button>
                            </div>
                        </form>
                    )}
                </Modal>
            )}
        </div>
    );
}

function FinancialInvoiceDetail({invoice,can,reload}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const allowedActions={pending_review:['review','reject'],returned:['review','reject'],reviewed:['approve','return','reject']}[invoice.review_status]||[];
 useEffect(()=>{const labels={Review:'review',Approve:'approve',Return:'return',Reject:'reject'};document.querySelectorAll('.card-header button').forEach(button=>{const action=labels[button.textContent.trim()];if(action)button.hidden=!allowedActions.includes(action)});},[invoice.review_status]);
 async function act(decision){const notes=window.prompt(`${decision} remarks`)||'';setBusy(true);try{await api.post(`/sales/invoice-center/${invoice.business_id}/review`,{decision,notes});setMessage(`Invoice ${decision} completed`);reload()}catch(e){setMessage(e.message)}finally{setBusy(false)}}
 const money=v=>`৳${Number(v||0).toLocaleString()}`;
 return <div><Link to="/invoices" className="breadcrumb-link">← All invoices</Link><div className="card-header" style={{margin:'10px 0 18px'}}><div><h1 className="page-title mono">{invoice.business_id}</h1><p className="card-subtitle">{String(invoice.invoice_type).replaceAll('_',' ')} · Source {invoice.source_id}</p></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><Pill status={invoice.review_status}/><button className="btn btn-primary" onClick={()=>downloadApiFile(`/documents/entity/FINANCIAL_INVOICE/${invoice.business_id}.pdf`,`${invoice.business_id}.pdf`)}>Download PDF</button><button className="btn btn-secondary" onClick={()=>downloadApiFile(`/documents/entity/FINANCIAL_INVOICE/${invoice.business_id}.pdf`,`${invoice.business_id}.pdf`,true)}>Print</button>{(can('ACCOUNTS_APPROVE')||can('SALES_APPROVE'))&&<><button disabled={busy} className="btn btn-secondary" onClick={()=>act('review')}>Review</button><button disabled={busy} className="btn btn-primary" onClick={()=>act('approve')}>Approve</button><button disabled={busy} className="btn btn-secondary" onClick={()=>act('return')}>Return</button><button disabled={busy} className="btn btn-danger" onClick={()=>act('reject')}>Reject</button></>}</div></div>{message&&<div className={message.includes('completed')?'success-banner':'error-banner'}>{message}</div>}<div className="stats-grid"><div className="stat-card"><div className="stat-label">Current invoice</div><div className="stat-value">{money(invoice.current_total)}</div></div><div className="stat-card"><div className="stat-label">Previous due</div><div className="stat-value">{money(invoice.previous_due_snapshot)}</div></div><div className="stat-card"><div className="stat-label">Total paid</div><div className="stat-value">{money(invoice.total_paid)}</div></div><div className="stat-card"><div className="stat-label">Current total due</div><div className="stat-value">{money(invoice.current_due)}</div></div></div><div className="card"><div className="card-header"><div><h2>Customer / organization</h2><p>{invoice.customer_name||'Company stock'} · {invoice.customer_business_id||'—'}</p></div><Pill status={invoice.status}/></div><p>{invoice.customer_address||'Address not provided'}</p><p>{invoice.customer_phone||''} {invoice.customer_email||''}</p></div><div className="card"><h2>Products, batches, rent and services</h2><DataTable rows={invoice.items||[]} columns={[{key:'product_name',label:'Product'},{key:'batch_business_id',label:'Batch / barcode'},{key:'location_name',label:'Location'},{key:'received_quantity',label:'Received'},{key:'current_quantity',label:'In store'},{key:'unit',label:'Unit'},{key:'rate',label:'Unit rate',render:r=>money(r.rate)},{key:'billing_cycle',label:'Cycle'},{key:'billed_cycles',label:'Cycles'},{key:'labor_amount',label:'Labor',render:r=>money(r.labor_amount)},{key:'service_amount',label:'Service',render:r=>money(r.service_amount)},{key:'line_total',label:'Total',render:r=>money(r.line_total)}]}/></div><div className="card"><h2>Review and approval</h2><p><strong>Reviewer:</strong> {invoice.reviewer_name||invoice.reviewer_username||'Pending'} {invoice.reviewed_at?`· ${new Date(invoice.reviewed_at).toLocaleString()}`:''}</p><p><strong>Approver:</strong> {invoice.approver_name||invoice.approver_username||'Pending'} {invoice.approved_at?`· ${new Date(invoice.approved_at).toLocaleString()}`:''}</p><p><strong>Remarks:</strong> {invoice.review_notes||'—'}</p><DataTable rows={invoice.events||[]} columns={[{key:'created_at',label:'Date',render:r=>new Date(r.created_at).toLocaleString()},{key:'actor_name',label:'Person'},{key:'action',label:'Action'},{key:'from_status',label:'From'},{key:'to_status',label:'To'},{key:'notes',label:'Remarks'}]}/></div><div className="stats-grid"><div className="stat-card"><div className="stat-label">Total received</div><div className="stat-value">{Number(invoice.total_received||0).toLocaleString()}</div></div><div className="stat-card"><div className="stat-label">Current stock</div><div className="stat-value">{Number(invoice.total_stock||0).toLocaleString()}</div></div><div className="stat-card"><div className="stat-label">Deliveries</div><div className="stat-value">{Number(invoice.total_deliveries||0).toLocaleString()}</div></div></div></div>
}
