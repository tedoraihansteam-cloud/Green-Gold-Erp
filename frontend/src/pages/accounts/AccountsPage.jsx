import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { IconPlus } from '../../components/Icons';
import BusinessIdentifier from '../../components/BusinessIdentifier';

export default function AccountsPage() {
    const { can } = useAuth();
    const { data, loading, error, reload } = useApi('/accounts');
    const { data: transferData, reload: reloadTransfers } = useApi('/accounts/transfer-requests');
    const { data: pendingData, reload: reloadPending } = useApi('/accounts/pending-actions');
    const {data:costData,reload:reloadCosts}=useApi('/financial-controls/cost-centers');
    const {data:reversalData,reload:reloadReversals}=useApi('/financial-controls/reversals');
    const [showCreate, setShowCreate] = useState(false);
    const [showTransfer, setShowTransfer] = useState(false);
    const [createForm, setCreateForm] = useState({ name: '', accountType: 'cash', bankName: '', bankAccountNumber: '', openingBalance: '' });
    const [transferForm, setTransferForm] = useState({ fromAccountBusinessId: '', toAccountBusinessId: '', amount: '', notes: '' });
    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);
    const [phase2,setPhase2]=useState(null),[costForm,setCostForm]=useState({code:'',name:''}),[refundForm,setRefundForm]=useState({refundType:'CUSTOMER_REFUND',accountBusinessId:'',partyBusinessId:'',amount:'',reason:'',reference:''}),[reversalForm,setReversalForm]=useState({transactionId:'',reason:''});

    const accounts = data?.accounts || [];

    const handleCreate = async (e) => {
        e.preventDefault();
        setBusy(true); setFormError('');
        try {
            await api.post('/accounts', createForm);
            setShowCreate(false);
            setCreateForm({ name: '', accountType: 'cash', bankName: '', bankAccountNumber: '', openingBalance: '' });
            reload();
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    const handleTransfer = async (e) => {
        e.preventDefault();
        setBusy(true); setFormError('');
        try {
            const result=await api.post('/accounts/transfer', { ...transferForm, amount: Number(transferForm.amount) });
            alert(result.pendingApproval?'Transfer submitted for approval. No balance has changed yet.':'Transfer completed and voucher generated.');
            setShowTransfer(false);
            setTransferForm({ fromAccountBusinessId: '', toAccountBusinessId: '', amount: '', notes: '' });
            reload(); reloadTransfers(); reloadPending();
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">Cash & bank accounts</h1>
                    <p className="card-subtitle">Balances update immediately from sales receipts, cancellations, transfers, expenses, and payroll</p>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                    {can('ACCOUNTS_CREATE') && accounts.length >= 2 && (
                        <button type="button" className="btn btn-secondary" onClick={() => { setFormError(''); setShowTransfer(true); }}>Transfer funds</button>
                    )}
                    {can('ACCOUNTS_CREATE') && (
                        <button type="button" className="btn btn-primary" onClick={() => { setFormError(''); setShowCreate(true); }}><IconPlus /> New account</button>
                    )}
                </div>
            </div>

            <div className="card">
                {error && <div className="error-banner">{error}</div>}
                {loading ? <p style={{ color: 'var(--ink-600)' }}>Loading…</p> : (
                    <DataTable
                        columns={[
                            { key: 'business_id', label: 'ID', render: (r) => <BusinessIdentifier entityType="ACCOUNT" businessId={r.business_id}><Link to={`/accounts/${r.business_id}`} className="mono" style={{ color: 'var(--husk-700)', fontWeight: 600 }}>{r.business_id}</Link></BusinessIdentifier> },
                            { key: 'name', label: 'Name' },
                            { key: 'account_type', label: 'Type' },
                            { key: 'current_balance', label: 'Balance', align: 'right', render: (r) => <span className="num">৳{Number(r.current_balance).toLocaleString()}</span> }
                        ]}
                        rows={accounts}
                        emptyMessage="No accounts yet."
                    />
                )}
            </div>

            <div className="card" style={{marginTop:18}}><div className="card-header"><div><h2>Transfer workflow</h2><p className="card-subtitle">Pending and completed account relocations with reviewer remarks and vouchers.</p></div></div><DataTable rows={transferData?.transferRequests||[]} emptyMessage="No account transfer requests." columns={[{key:'business_id',label:'Request'},{key:'requested_at',label:'Requested',render:r=>new Date(r.requested_at).toLocaleString()},{key:'from_account_name',label:'From'},{key:'to_account_name',label:'To'},{key:'amount',label:'Amount',render:r=>`BDT ${Number(r.amount).toLocaleString()}`},{key:'notes',label:'Remarks'},{key:'status',label:'Status'},{key:'voucher_business_id',label:'Voucher',render:r=>r.voucher_business_id||'—'},{key:'actions',label:'Actions',render:r=>r.status==='pending_approval'&&can('ACCOUNTS_APPROVE')?<div style={{display:'flex',gap:6}}><button className="btn btn-primary btn-sm" onClick={async()=>{const notes=prompt('Approval remarks (required)');if(!notes)return;try{await api.post(`/accounts/transfer-requests/${r.business_id}/review`,{decision:'approve',notes});reload();reloadTransfers();}catch(e){alert(e.message)}}}>Approve</button><button className="btn btn-danger btn-sm" onClick={async()=>{const notes=prompt('Rejection reason (required)');if(!notes)return;try{await api.post(`/accounts/transfer-requests/${r.business_id}/review`,{decision:'reject',notes});reloadTransfers();}catch(e){alert(e.message)}}}>Reject</button></div>:'—'}]}/></div>
            <div className="card" style={{marginTop:18}}><div className="card-header"><div><h2>Pending financial actions</h2><p className="card-subtitle">Expenses, bills, payroll, transfers, overdue customer dues, commitments and Accounts requests needing attention.</p></div></div><DataTable rows={pendingData?.actions||[]} emptyMessage="No pending financial actions." columns={[{key:'action_type',label:'Action'},{key:'business_id',label:'Reference'},{key:'subject',label:'Details'},{key:'amount',label:'Amount',render:r=>r.amount==null?'—':`BDT ${Number(r.amount).toLocaleString()}`},{key:'status',label:'Status'},{key:'created_at',label:'Since',render:r=>new Date(r.created_at).toLocaleString()}]}/></div>
            <div className="card" style={{marginTop:18}}><div className="card-header"><div><h2>Financial controls</h2><p className="card-subtitle">Cost centers, controlled refunds and append-only transaction reversals.</p></div>{can('ACCOUNTS_CREATE')&&<div style={{display:'flex',gap:6}}><button className="btn btn-secondary" onClick={()=>setPhase2('cost')}>New cost center</button><button className="btn btn-secondary" onClick={()=>setPhase2('refund')}>Record refund</button><button className="btn btn-primary" onClick={()=>setPhase2('reversal')}>Request reversal</button></div>}</div><DataTable rows={costData?.costCenters||[]} emptyMessage="No cost centers configured." columns={[{key:'business_id',label:'Cost center'},{key:'code',label:'Code'},{key:'name',label:'Name'},{key:'department_name',label:'Department',render:r=>r.department_name||'Company-wide'},{key:'active',label:'Status',render:r=>r.active?'Active':'Inactive'}]}/><h3 style={{marginTop:20}}>Reversal workflow</h3><DataTable rows={reversalData?.reversals||[]} emptyMessage="No reversal requests." columns={[{key:'business_id',label:'Reversal'},{key:'account_name',label:'Account'},{key:'transaction_type',label:'Original movement'},{key:'amount',label:'Amount',render:r=>`BDT ${Number(r.amount).toLocaleString()}`},{key:'reason',label:'Reason'},{key:'status',label:'Status'},{key:'actions',label:'Actions',render:r=>r.status==='pending_approval'&&can('ACCOUNTS_APPROVE')?<div style={{display:'flex',gap:6}}>{['approve','reject'].map(d=><button key={d} className={`btn btn-${d==='approve'?'primary':'danger'} btn-sm`} onClick={async()=>{const notes=prompt(`${d} remarks (required)`);if(!notes)return;try{await api.post(`/financial-controls/reversals/${r.business_id}/review`,{decision:d,notes});reload();reloadReversals();}catch(e){alert(e.message)}}}>{d}</button>)}</div>:'—'}]}/></div>

            {phase2==='cost'&&<Modal title="New cost center" onClose={()=>setPhase2(null)}><form onSubmit={async e=>{e.preventDefault();try{await api.post('/financial-controls/cost-centers',costForm);setPhase2(null);setCostForm({code:'',name:''});reloadCosts()}catch(x){alert(x.message)}}}><div className="field"><label>Code *</label><input required value={costForm.code} onChange={e=>setCostForm({...costForm,code:e.target.value})}/></div><div className="field"><label>Name *</label><input required value={costForm.name} onChange={e=>setCostForm({...costForm,name:e.target.value})}/></div><div className="form-actions"><button className="btn btn-primary">Create</button></div></form></Modal>}
            {phase2==='refund'&&<Modal title="Record controlled refund" onClose={()=>setPhase2(null)}><form onSubmit={async e=>{e.preventDefault();try{await api.post('/financial-controls/refunds',{...refundForm,amount:Number(refundForm.amount)});setPhase2(null);reload();reloadPending();}catch(x){alert(x.message);}}}><div className="field"><label>Refund type</label><select value={refundForm.refundType} onChange={e=>setRefundForm({...refundForm,refundType:e.target.value})}><option value="CUSTOMER_REFUND">Payment to customer</option><option value="SUPPLIER_REFUND">Money received from supplier</option><option value="EMPLOYEE_REFUND">Money received from employee</option></select></div><div className="field"><label>Customer/vendor/employee ID *</label><input required value={refundForm.partyBusinessId} onChange={e=>setRefundForm({...refundForm,partyBusinessId:e.target.value})}/></div><div className="field"><label>Cash/bank account *</label><select required value={refundForm.accountBusinessId} onChange={e=>setRefundForm({...refundForm,accountBusinessId:e.target.value})}><option value="">Select</option>{accounts.map(a=><option key={a.id} value={a.business_id}>{a.name}</option>)}</select></div><div className="field"><label>Amount *</label><input required type="number" min="0.01" step="0.01" value={refundForm.amount} onChange={e=>setRefundForm({...refundForm,amount:e.target.value})}/></div><div className="field"><label>Reason *</label><textarea required value={refundForm.reason} onChange={e=>setRefundForm({...refundForm,reason:e.target.value})}/></div><div className="field"><label>External reference</label><input value={refundForm.reference} onChange={e=>setRefundForm({...refundForm,reference:e.target.value})}/></div><div className="form-actions"><button className="btn btn-primary">Post refund and voucher</button></div></form></Modal>}
            {phase2==='reversal'&&<Modal title="Request transaction reversal" onClose={()=>setPhase2(null)}><form onSubmit={async e=>{e.preventDefault();try{await api.post('/financial-controls/reversals',reversalForm);setPhase2(null);setReversalForm({transactionId:'',reason:''});reloadReversals();}catch(x){alert(x.message);}}}><div className="field"><label>Account transaction ID *</label><input required type="number" value={reversalForm.transactionId} onChange={e=>setReversalForm({...reversalForm,transactionId:e.target.value})}/></div><div className="field"><label>Reversal reason *</label><textarea required value={reversalForm.reason} onChange={e=>setReversalForm({...reversalForm,reason:e.target.value})}/></div><div className="form-actions"><button className="btn btn-primary">Submit for approval</button></div></form></Modal>}

            {showCreate && (
                <Modal title="New account" onClose={() => setShowCreate(false)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={handleCreate}>
                        <div className="field">
                            <label htmlFor="accName">Name *</label>
                            <input id="accName" required value={createForm.name} onChange={(e) => setCreateForm((s) => ({ ...s, name: e.target.value }))} />
                        </div>
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="accType">Type *</label>
                                <select id="accType" value={createForm.accountType} onChange={(e) => setCreateForm((s) => ({ ...s, accountType: e.target.value }))}>
                                    <option value="cash">Cash</option>
                                    <option value="bank">Bank</option>
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="openingBalance">Opening balance (৳)</label>
                                <input id="openingBalance" type="number" step="0.01" value={createForm.openingBalance} onChange={(e) => setCreateForm((s) => ({ ...s, openingBalance: e.target.value }))} />
                            </div>
                        </div>
                        {createForm.accountType === 'bank' && (
                            <div className="form-grid">
                                <div className="field">
                                    <label htmlFor="bankName">Bank name</label>
                                    <input id="bankName" value={createForm.bankName} onChange={(e) => setCreateForm((s) => ({ ...s, bankName: e.target.value }))} />
                                </div>
                                <div className="field">
                                    <label htmlFor="bankAccountNumber">Account number</label>
                                    <input id="bankAccountNumber" value={createForm.bankAccountNumber} onChange={(e) => setCreateForm((s) => ({ ...s, bankAccountNumber: e.target.value }))} />
                                </div>
                            </div>
                        )}
                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
                        </div>
                    </form>
                </Modal>
            )}

            {showTransfer && (
                <Modal title="Transfer funds" onClose={() => setShowTransfer(false)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={handleTransfer}>
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="fromAcc">From *</label>
                                <select id="fromAcc" required value={transferForm.fromAccountBusinessId} onChange={(e) => setTransferForm((s) => ({ ...s, fromAccountBusinessId: e.target.value }))}>
                                    <option value="">Select…</option>
                                    {accounts.map((a) => <option key={a.id} value={a.business_id}>{a.name} (৳{Number(a.current_balance).toLocaleString()})</option>)}
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="toAcc">To *</label>
                                <select id="toAcc" required value={transferForm.toAccountBusinessId} onChange={(e) => setTransferForm((s) => ({ ...s, toAccountBusinessId: e.target.value }))}>
                                    <option value="">Select…</option>
                                    {accounts.map((a) => <option key={a.id} value={a.business_id}>{a.name}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="field">
                            <label htmlFor="transferAmount">Amount (৳) *</label>
                            <input id="transferAmount" type="number" step="0.01" min="0.01" required value={transferForm.amount} onChange={(e) => setTransferForm((s) => ({ ...s, amount: e.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="transferNotes">Transfer reason / remarks *</label>
                            <input id="transferNotes" required value={transferForm.notes} onChange={(e) => setTransferForm((s) => ({ ...s, notes: e.target.value }))} />
                        </div>
                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowTransfer(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Transferring…' : 'Transfer'}</button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    );
}
