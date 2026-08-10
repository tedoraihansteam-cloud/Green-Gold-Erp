import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import Pill from '../../components/Pill';
import { IconPlus } from '../../components/Icons';
import BusinessIdentifier from '../../components/BusinessIdentifier';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function PayrollRunsPage() {
    const { can } = useAuth();
    const { data, loading, error, reload } = useApi('/hr/payroll-runs');
    const { data: accData } = useApi('/accounts');

    const [showCreate, setShowCreate] = useState(false);
    const now = new Date();
    const [createForm, setCreateForm] = useState({ periodYear: now.getFullYear(), periodMonth: now.getMonth() + 1 });
    const [viewingRun, setViewingRun] = useState(null);
    const { data: runDetail, reload: reloadDetail } = useApi(viewingRun ? `/hr/payroll-runs/${viewingRun}` : null);
    const [editingItem, setEditingItem] = useState(null);
    const [itemForm, setItemForm] = useState({ overtime: '', bonus: '', providentFundDeduction: '', taxDeduction: '', lateDeduction: '', loanDeduction: '', advanceDeduction: '', otherDeduction: '' });
    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);
    const [showAccountsApproval, setShowAccountsApproval] = useState(false);
    const [approvalForm, setApprovalForm] = useState({ payingAccountBusinessId: '', notes: '' });

    const runs = data?.payrollRuns || [];
    const accounts = accData?.accounts || [];

    const handleCreate = async (e) => {
        e.preventDefault();
        setBusy(true); setFormError('');
        try {
            const res = await api.post('/hr/payroll-runs', createForm);
            setShowCreate(false);
            reload();
            setViewingRun(res.payrollRun.business_id);
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    const openItemEdit = (item) => {
        setEditingItem(item);
        setItemForm({
            overtime: item.overtime, bonus: item.bonus, providentFundDeduction: item.provident_fund_deduction,
            taxDeduction: item.tax_deduction, lateDeduction: item.late_deduction, loanDeduction: item.loan_deduction,
            advanceDeduction: item.advance_deduction, otherDeduction: item.other_deduction
        });
    };

    const saveItem = async (e) => {
        e.preventDefault();
        setBusy(true); setFormError('');
        try {
            await api.put(`/hr/payroll-runs/${viewingRun}/items/${editingItem.employee_business_id}`, itemForm);
            setEditingItem(null);
            reloadDetail();
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    const processRun = async () => {
        if (!confirm('Process this payroll run? This posts a withdrawal to the paying account and cannot be undone.')) return;
        setBusy(true);
        try {
            await api.post(`/hr/payroll-runs/${viewingRun}/process`);
            reloadDetail();
            reload();
        } catch (err) { alert(err.message); } finally { setBusy(false); }
    };
    const workflow = async (action, body = {}) => { try { await api.post(`/hr/payroll-runs/${viewingRun}/${action}`, body); reloadDetail(); reload(); } catch (err) { alert(err.message); } };
    const approveForAccounts = async (event) => {
        event.preventDefault(); setBusy(true); setFormError('');
        try { await api.post(`/hr/payroll-runs/${viewingRun}/accounts-approve`, approvalForm); setShowAccountsApproval(false); await reloadDetail(); reload(); }
        catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">Payroll</h1>
                    <p className="card-subtitle">Draft from current salaries, adjust per employee, then process to post payment</p>
                </div>
                {can('HR_CREATE') && <button type="button" className="btn btn-primary" onClick={() => { setFormError(''); setShowCreate(true); }}><IconPlus /> New payroll run</button>}
            </div>

            <div className="card">
                {error && <div className="error-banner">{error}</div>}
                {loading ? <p style={{ color: 'var(--ink-600)' }}>Loading…</p> : (
                    <DataTable
                        columns={[
                            { key: 'business_id', label: 'ID', render: (r) => <BusinessIdentifier entityType="PAYROLL_RUN" businessId={r.business_id}><button type="button" className="btn-ghost mono" onClick={() => setViewingRun(r.business_id)}>{r.business_id}</button></BusinessIdentifier> },
                            { key: 'period', label: 'Period', render: (r) => `${MONTHS[r.period_month - 1]} ${r.period_year}` },
                            { key: 'employee_count', label: 'Employees', align: 'right' },
                            { key: 'total_net_pay', label: 'Total net pay', align: 'right', render: (r) => <span className="num">৳{Number(r.total_net_pay).toLocaleString()}</span> },
                            { key: 'status', label: 'Status', render: (r) => <Pill status={r.status} /> }
                        ]}
                        rows={runs}
                        emptyMessage="No payroll runs yet."
                    />
                )}
            </div>

            {showCreate && (
                <Modal title="New payroll run" onClose={() => setShowCreate(false)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={handleCreate}>
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="pyYear">Year</label>
                                <input id="pyYear" type="number" value={createForm.periodYear} onChange={(e) => setCreateForm((s) => ({ ...s, periodYear: Number(e.target.value) }))} />
                            </div>
                            <div className="field">
                                <label htmlFor="pyMonth">Month</label>
                                <select id="pyMonth" value={createForm.periodMonth} onChange={(e) => setCreateForm((s) => ({ ...s, periodMonth: Number(e.target.value) }))}>
                                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="field">
                            <label>Payment account</label>
                            <input disabled value="Accounts selects this after approving the pay order" />
                        </div>
                        <div className="hint" style={{ marginBottom: 14 }}>Draft slips will be created for every active employee using their current salary. You can adjust each one before processing.</div>
                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create draft'}</button>
                        </div>
                    </form>
                </Modal>
            )}

            {viewingRun && runDetail && (
                <Modal title={`${MONTHS[runDetail.payrollRun.period_month - 1]} ${runDetail.payrollRun.period_year} payroll`} onClose={() => setViewingRun(null)} wide>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                        <Pill status={runDetail.payrollRun.status} />
                        <div style={{display:'flex',gap:6}}>
                            {runDetail.payrollRun.status === 'draft' && can('HR_APPROVE') && <button type="button" className="btn btn-primary btn-sm" onClick={() => workflow('submit-pay-order')}>Submit pay order</button>}
                            {runDetail.payrollRun.status === 'submitted_to_accounts' && can('ACCOUNTS_APPROVE') && <button type="button" className="btn btn-primary btn-sm" onClick={() => { setApprovalForm({payingAccountBusinessId:'',notes:''}); setFormError(''); setShowAccountsApproval(true); }}>Accounts define payment</button>}
                            {runDetail.payrollRun.status === 'accounts_approved' && can('ACCOUNTS_CREATE') && <button type="button" className="btn btn-primary btn-sm" onClick={processRun}>Process approved payment</button>}
                        </div>
                    </div>
                    {runDetail.payrollRun.paying_account_name&&<div className="success-banner" style={{marginBottom:12}}>Deduction account: <strong>{runDetail.payrollRun.paying_account_name}</strong> ({runDetail.payrollRun.paying_account_business_id}){runDetail.payrollRun.approval_notes&&<> · Remark: {runDetail.payrollRun.approval_notes}</>}</div>}
                    <DataTable
                        columns={[
                            { key: 'full_name', label: 'Employee' },
                            { key: 'gross_pay', label: 'Gross', align: 'right', render: (r) => <span className="num">৳{Number(r.gross_pay).toLocaleString()}</span> },
                            { key: 'total_deductions', label: 'Deductions', align: 'right', render: (r) => <span className="num">৳{Number(r.total_deductions).toLocaleString()}</span> },
                            { key: 'net_pay', label: 'Net pay', align: 'right', render: (r) => <span className="num" style={{ fontWeight: 700 }}>৳{Number(r.net_pay).toLocaleString()}</span> },
                            { key: 'actions', label: '', render: (r) => runDetail.payrollRun.status === 'draft' && can('HR_EDIT') && (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openItemEdit(r)}>Adjust</button>
                            )}
                        ]}
                        rows={runDetail.payrollRun.items || []}
                    />
                </Modal>
            )}

            {editingItem && (
                <Modal title={`Adjust — ${editingItem.full_name}`} onClose={() => setEditingItem(null)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={saveItem}>
                        <div className="form-grid">
                            <div className="field"><label htmlFor="itOvertime">Overtime (+)</label><input id="itOvertime" type="number" step="0.01" value={itemForm.overtime} onChange={(e) => setItemForm((s) => ({ ...s, overtime: e.target.value }))} /></div>
                            <div className="field"><label htmlFor="itBonus">Bonus (+)</label><input id="itBonus" type="number" step="0.01" value={itemForm.bonus} onChange={(e) => setItemForm((s) => ({ ...s, bonus: e.target.value }))} /></div>
                        </div>
                        <div className="form-grid">
                            <div className="field"><label htmlFor="itTax">Tax deduction (−)</label><input id="itTax" type="number" step="0.01" value={itemForm.taxDeduction} onChange={(e) => setItemForm((s) => ({ ...s, taxDeduction: e.target.value }))} /></div>
                            <div className="field"><label htmlFor="itLate">Late deduction (−)</label><input id="itLate" type="number" step="0.01" value={itemForm.lateDeduction} onChange={(e) => setItemForm((s) => ({ ...s, lateDeduction: e.target.value }))} /></div>
                        </div>
                        <div className="form-grid">
                            <div className="field"><label htmlFor="itLoan">Loan deduction (−)</label><input id="itLoan" type="number" step="0.01" value={itemForm.loanDeduction} onChange={(e) => setItemForm((s) => ({ ...s, loanDeduction: e.target.value }))} /></div>
                            <div className="field"><label htmlFor="itAdvance">Advance deduction (−)</label><input id="itAdvance" type="number" step="0.01" value={itemForm.advanceDeduction} onChange={(e) => setItemForm((s) => ({ ...s, advanceDeduction: e.target.value }))} /></div>
                        </div>
                        <div className="field"><label htmlFor="itOther">Other deduction (−)</label><input id="itOther" type="number" step="0.01" value={itemForm.otherDeduction} onChange={(e) => setItemForm((s) => ({ ...s, otherDeduction: e.target.value }))} /></div>
                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setEditingItem(null)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
                        </div>
                    </form>
                </Modal>
            )}

            {showAccountsApproval && runDetail && (
                <Modal title="Accounts payroll approval" onClose={() => setShowAccountsApproval(false)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <div className="success-banner">Payroll deduction: <strong>BDT {Number(runDetail.payrollRun.items?.reduce((sum,item)=>sum+Number(item.net_pay),0)||0).toLocaleString('en-BD')}</strong></div>
                    <form onSubmit={approveForAccounts}>
                        <div className="field"><label>Deduct from account *</label><select required value={approvalForm.payingAccountBusinessId} onChange={e=>setApprovalForm(s=>({...s,payingAccountBusinessId:e.target.value}))}><option value="">Select cash or bank account</option>{accounts.map(account=><option key={account.id} value={account.business_id}>{account.name} ({account.business_id}) — balance BDT {Number(account.current_balance).toLocaleString('en-BD')}</option>)}</select></div>
                        <div className="field"><label>Accounts remark</label><textarea rows="3" value={approvalForm.notes} onChange={e=>setApprovalForm(s=>({...s,notes:e.target.value}))} placeholder="Payment instruction, reference, exception or other remark" /></div>
                        <div className="form-actions"><button type="button" className="btn btn-secondary" onClick={()=>setShowAccountsApproval(false)}>Cancel</button><button disabled={busy} className="btn btn-primary">{busy?'Approving…':'Approve selected account'}</button></div>
                    </form>
                </Modal>
            )}
        </div>
    );
}
