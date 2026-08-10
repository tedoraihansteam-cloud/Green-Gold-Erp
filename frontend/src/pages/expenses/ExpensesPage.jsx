import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import Pill from '../../components/Pill';
import { IconPlus } from '../../components/Icons';
import BusinessIdentifier from '../../components/BusinessIdentifier';

export default function ExpensesPage() {
    const [searchParams,setSearchParams]=useSearchParams();
    const { can } = useAuth();
    const { data, loading, error, reload } = useApi('/expenses');
    const { data: catData, reload: reloadCats } = useApi('/expenses/categories');
    const { data: accData } = useApi('/accounts');
    const {data:costData}=useApi('/financial-controls/cost-centers');

    const [showForm, setShowForm] = useState(false);
    const [showCatForm, setShowCatForm] = useState(false);
    const [form, setForm] = useState({ categoryId: '', accountBusinessId: '',costCenterBusinessId:'',financialClassification:'OPERATING_EXPENSE',taxRate:'0',taxAmount:'0',taxReference:'', amount: '', description: '', paidTo: '', expenseDate: new Date().toISOString().slice(0, 10) });
    const [catForm, setCatForm] = useState({ code: '', name: '' });
    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(()=>{if(searchParams.get('create')==='1'){setShowForm(true);setSearchParams({}, {replace:true})}},[searchParams,setSearchParams]);

    const expenses = data?.expenses || [];
    const categories = catData?.categories || [];
    const accounts = accData?.accounts || [];

    const resetForm = () => setForm({ categoryId: '', accountBusinessId: '',costCenterBusinessId:'',financialClassification:'OPERATING_EXPENSE',taxRate:'0',taxAmount:'0',taxReference:'', amount: '', description: '', paidTo: '', expenseDate: new Date().toISOString().slice(0, 10) });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setBusy(true); setFormError('');
        try {
            await api.post('/expenses', { ...form, amount: Number(form.amount),taxRate:Number(form.taxRate||0),taxAmount:Number(form.taxAmount||0) });
            setShowForm(false); resetForm(); reload();
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    const handleCatSubmit = async (e) => {
        e.preventDefault();
        setBusy(true); setFormError('');
        try {
            await api.post('/expenses/categories', catForm);
            setShowCatForm(false); setCatForm({ code: '', name: '' }); reloadCats();
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    const approve = async (businessId) => { await api.post(`/expenses/${businessId}/approve`); reload(); };
    const reject = async (businessId) => {
        const reason = prompt('Reason for rejecting this expense?') || '';
        await api.post(`/expenses/${businessId}/reject`, { reason });
        reload();
    };

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">Expenses</h1>
                    <p className="card-subtitle">Small expenses post immediately; larger ones wait for approval</p>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                    {can('ACCOUNTS_CREATE') && <button type="button" className="btn btn-secondary" onClick={() => { setFormError(''); setShowCatForm(true); }}>Manage categories</button>}
                    {can('ACCOUNTS_CREATE') && <button type="button" className="btn btn-primary" onClick={() => { setFormError(''); setShowForm(true); }}><IconPlus /> New expense</button>}
                </div>
            </div>

            <div className="card">
                {error && <div className="error-banner">{error}</div>}
                {loading ? <p style={{ color: 'var(--ink-600)' }}>Loading…</p> : (
                    <DataTable
                        columns={[
                            { key: 'business_id', label: 'ID', render: (r) => <BusinessIdentifier entityType="EXPENSE" businessId={r.business_id} /> },
                            { key: 'category_name', label: 'Category' },
                            { key: 'description', label: 'Description' },
                            { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="num">৳{Number(r.amount).toLocaleString()}</span> },
                            { key: 'account_name', label: 'Account' },
                            {key:'cost_center_name',label:'Cost center',render:r=>r.cost_center_name||'—'},
                            {key:'financial_classification',label:'Classification'},
                            { key: 'status', label: 'Status', render: (r) => <Pill status={r.status} /> },
                            { key: 'actions', label: '', render: (r) => r.status === 'pending_approval' && can('ACCOUNTS_APPROVE') ? (
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => approve(r.business_id)}>Approve</button>
                                    <button type="button" className="btn btn-danger btn-sm" onClick={() => reject(r.business_id)}>Reject</button>
                                </div>
                            ) : null }
                        ]}
                        rows={expenses}
                        emptyMessage="No expenses logged yet."
                    />
                )}
            </div>

            {showForm && (
                <Modal title="New expense" onClose={() => setShowForm(false)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={handleSubmit}>
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="expCategory">Category *</label>
                                <select id="expCategory" required value={form.categoryId} onChange={(e) => setForm((s) => ({ ...s, categoryId: e.target.value }))}>
                                    <option value="">Select…</option>
                                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="expAccount">Paid from *</label>
                                <select id="expAccount" required value={form.accountBusinessId} onChange={(e) => setForm((s) => ({ ...s, accountBusinessId: e.target.value }))}>
                                    <option value="">Select…</option>
                                    {accounts.map((a) => <option key={a.id} value={a.business_id}>{a.name}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="form-grid"><div className="field"><label>Cost center</label><select value={form.costCenterBusinessId} onChange={e=>setForm(s=>({...s,costCenterBusinessId:e.target.value}))}><option value="">Company-wide</option>{(costData?.costCenters||[]).filter(x=>x.active).map(x=><option key={x.id} value={x.business_id}>{x.code} — {x.name}</option>)}</select></div><div className="field"><label>Financial classification</label><select value={form.financialClassification} onChange={e=>setForm(s=>({...s,financialClassification:e.target.value}))}><option value="OPERATING_EXPENSE">Operating expense</option><option value="PAYROLL_EXPENSE">Payroll expense</option><option value="MAINTENANCE_EXPENSE">Maintenance expense</option><option value="TRAVEL_ALLOWANCE">Travel / allowance</option><option value="CAPITAL_EXPENDITURE">Capital expenditure</option><option value="TAX_PAYMENT">Tax payment</option></select></div></div>
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="expAmount">Amount (৳) *</label>
                                <input id="expAmount" type="number" step="0.01" min="0.01" required value={form.amount} onChange={(e) => setForm((s) => ({ ...s, amount: e.target.value }))} />
                            </div>
                            <div className="field">
                                <label htmlFor="expDate">Date</label>
                                <input id="expDate" type="date" value={form.expenseDate} onChange={(e) => setForm((s) => ({ ...s, expenseDate: e.target.value }))} />
                            </div>
                        </div>
                        <div className="form-grid"><div className="field"><label>Tax/VAT rate (%)</label><input type="number" min="0" step="0.01" value={form.taxRate} onChange={e=>setForm(s=>({...s,taxRate:e.target.value}))}/></div><div className="field"><label>Tax/VAT amount</label><input type="number" min="0" step="0.01" value={form.taxAmount} onChange={e=>setForm(s=>({...s,taxAmount:e.target.value}))}/></div></div><div className="field"><label>Tax/VAT reference</label><input value={form.taxReference} onChange={e=>setForm(s=>({...s,taxReference:e.target.value}))}/></div>
                        <div className="field">
                            <label htmlFor="expPaidTo">Paid to</label>
                            <input id="expPaidTo" value={form.paidTo} onChange={(e) => setForm((s) => ({ ...s, paidTo: e.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="expDesc">Description</label>
                            <textarea id="expDesc" rows={2} value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} />
                        </div>
                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Submit expense'}</button>
                        </div>
                    </form>
                </Modal>
            )}

            {showCatForm && (
                <Modal title="Expense categories" onClose={() => setShowCatForm(false)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <DataTable columns={[{ key: 'code', label: 'Code', render: (r) => <span className="mono">{r.code}</span> }, { key: 'name', label: 'Name' }]} rows={categories} />
                    <form onSubmit={handleCatSubmit} style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="catCode">Code *</label>
                                <input id="catCode" required value={catForm.code} onChange={(e) => setCatForm((s) => ({ ...s, code: e.target.value }))} />
                            </div>
                            <div className="field">
                                <label htmlFor="catName">Name *</label>
                                <input id="catName" required value={catForm.name} onChange={(e) => setCatForm((s) => ({ ...s, name: e.target.value }))} />
                            </div>
                        </div>
                        <div className="form-actions">
                            <button type="submit" className="btn btn-primary" disabled={busy}>Add category</button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    );
}
