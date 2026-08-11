import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import Pill from '../../components/Pill';
import { IconPlus } from '../../components/Icons';
import BusinessIdentifier from '../../components/BusinessIdentifier';
import { Link } from 'react-router-dom';

export default function EmployeesPage() {
    const { can } = useAuth();
    const { data, loading, error, reload } = useApi('/employees');
    const { data: tplData } = useApi('/hr/salary-templates');
    const {data:branchData}=useApi('/org/branches');const {data:departmentData}=useApi('/org/departments');

    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ fullName:'',designation:'',phone:'',email:'',joinDate:'',branchId:'',departmentId:'' });

    const [salaryEmployee, setSalaryEmployee] = useState(null);
    const [statusEmployee, setStatusEmployee] = useState(null);
    const [statusForm, setStatusForm] = useState({ status: 'active', statusReason: '' });
    const { data: historyData, reload: reloadHistory } = useApi(salaryEmployee ? `/hr/employees/${salaryEmployee.business_id}/salary-history` : null);
    const [salaryForm, setSalaryForm] = useState({ templateBusinessId: '', basic: '', houseRent: '', medical: '', transport: '', food: '', specialAllowance: '', providentFundPercent: '', effectiveDate: new Date().toISOString().slice(0, 10), notes: '' });

    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);

    const employees = data?.employees || [];
    const templates = tplData?.templates || [];

    const handleCreate = async (e) => {
        e.preventDefault();
        setBusy(true); setFormError('');
        try {
            await api.post('/employees', form);
            setShowForm(false);
            setForm({fullName:'',designation:'',phone:'',email:'',joinDate:'',branchId:'',departmentId:''});
            reload();
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    const openSalary = (emp) => {
        setSalaryEmployee(emp);
        setSalaryForm({ templateBusinessId: '', basic: '', houseRent: '', medical: '', transport: '', food: '', specialAllowance: '', providentFundPercent: '', effectiveDate: new Date().toISOString().slice(0, 10), notes: '' });
        setFormError('');
    };

    const openStatus = (emp) => {
        setStatusEmployee(emp);
        setStatusForm({ status: emp.status || 'active', statusReason: '' });
        setFormError('');
    };

    const handleStatusSubmit = async (e) => {
        e.preventDefault();
        setBusy(true); setFormError('');
        try {
            await api.put(`/employees/${statusEmployee.business_id}`, statusForm);
            setStatusEmployee(null);
            reload();
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    const applyTemplate = (templateBusinessId) => {
        const t = templates.find((x) => x.business_id === templateBusinessId);
        if (t) {
            setSalaryForm((s) => ({ ...s, templateBusinessId, basic: t.basic, houseRent: t.house_rent, medical: t.medical, transport: t.transport, food: t.food, specialAllowance: t.special_allowance, providentFundPercent: t.provident_fund_percent }));
        } else {
            setSalaryForm((s) => ({ ...s, templateBusinessId }));
        }
    };

    const handleSalarySubmit = async (e) => {
        e.preventDefault();
        setBusy(true); setFormError('');
        try {
            await api.post(`/hr/employees/${salaryEmployee.business_id}/salary`, salaryForm);
            reloadHistory();
            setSalaryForm((s) => ({ ...s, basic: '', houseRent: '', medical: '', transport: '', food: '', specialAllowance: '', providentFundPercent: '', notes: '' }));
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">Employees</h1>
                    <p className="card-subtitle">Permanent employee master records, with permanent salary history</p>
                </div>
                {can('HR_CREATE') && <button type="button" className="btn btn-primary" onClick={() => { setFormError(''); setShowForm(true); }}><IconPlus /> New employee</button>}
            </div>

            <div className="card">
                {error && <div className="error-banner">{error}</div>}
                {loading ? <p style={{ color: 'var(--ink-600)' }}>Loading…</p> : (
                    <DataTable
                        columns={[
                            { key: 'business_id', label: 'ID', render: (r) => <BusinessIdentifier entityType="EMPLOYEE" businessId={r.business_id} /> },
                            { key: 'full_name', label: 'Name', render: (r) => <Link to={`/employees/${r.business_id}`}>{r.full_name}</Link> },
                            { key: 'designation', label: 'Designation' },
                            {key:'department_name',label:'Department',render:r=>r.department_name?`${r.department_code} — ${r.department_name}`:'Not assigned'},
                            {key:'site_name',label:'Location',render:r=>r.site_name||r.branch_name||'Not assigned'},
                            { key: 'phone', label: 'Phone' },
                            { key: 'status', label: 'Status', render: (r) => <Pill status={r.status} /> },
                            { key: 'actions', label: 'Actions', render: (r) => can('HR_EDIT') && <span style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openSalary(r)}>Salary</button>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openStatus(r)}>Active / inactive</button>
                            </span>}
                        ]}
                        rows={employees}
                        emptyMessage="No employees yet."
                    />
                )}
            </div>

            {showForm && (
                <Modal title="New employee" onClose={() => setShowForm(false)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={handleCreate}>
                        <div className="field"><label htmlFor="fullName">Full name *</label><input id="fullName" required value={form.fullName} onChange={(e) => setForm((s) => ({ ...s, fullName: e.target.value }))} /></div>
                        <div className="form-grid">
                            <div className="field"><label>Branch</label><select value={form.branchId} onChange={e=>setForm(s=>({...s,branchId:e.target.value,departmentId:''}))}><option value="">Select branch</option>{(branchData?.branches||[]).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></div><div className="field"><label>Department</label><select value={form.departmentId} onChange={e=>setForm(s=>({...s,departmentId:e.target.value}))}><option value="">Select department</option>{(departmentData?.departments||[]).filter(x=>!form.branchId||x.branch_id===form.branchId).map(x=><option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</select></div>
                        </div><div className="form-grid">
                            <div className="field"><label htmlFor="designation">Designation</label><input id="designation" value={form.designation} onChange={(e) => setForm((s) => ({ ...s, designation: e.target.value }))} /></div>
                            <div className="field"><label htmlFor="joinDate">Join date</label><input id="joinDate" type="date" value={form.joinDate} onChange={(e) => setForm((s) => ({ ...s, joinDate: e.target.value }))} /></div>
                        </div>
                        <div className="form-grid">
                            <div className="field"><label htmlFor="phone">Phone</label><input id="phone" value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} /></div>
                            <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} /></div>
                        </div>
                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
                        </div>
                    </form>
                </Modal>
            )}

            {salaryEmployee && (
                <Modal title={`Salary — ${salaryEmployee.full_name}`} onClose={() => setSalaryEmployee(null)} wide>
                    {formError && <div className="error-banner">{formError}</div>}
                    <h3 style={{ fontSize: 13, marginBottom: 8 }}>History</h3>
                    <DataTable
                        columns={[
                            { key: 'effective_date', label: 'From', render: (r) => new Date(r.effective_date).toLocaleDateString() },
                            { key: 'end_date', label: 'To', render: (r) => r.end_date ? new Date(r.end_date).toLocaleDateString() : 'current' },
                            { key: 'basic', label: 'Basic', align: 'right', render: (r) => <span className="num">৳{Number(r.basic).toLocaleString()}</span> },
                            { key: 'total', label: 'Gross', align: 'right', render: (r) => <span className="num">৳{(Number(r.basic) + Number(r.house_rent) + Number(r.medical) + Number(r.transport) + Number(r.food) + Number(r.special_allowance)).toLocaleString()}</span> }
                        ]}
                        rows={historyData?.history || []}
                        emptyMessage="No salary set yet."
                    />

                    <h3 style={{ fontSize: 13, margin: '20px 0 8px' }}>Set new salary (manual, requires this explicit action)</h3>
                    <form onSubmit={handleSalarySubmit}>
                        <div className="field">
                            <label htmlFor="salTemplate">Use a template (optional)</label>
                            <select id="salTemplate" value={salaryForm.templateBusinessId} onChange={(e) => applyTemplate(e.target.value)}>
                                <option value="">Custom amounts…</option>
                                {templates.map((t) => <option key={t.id} value={t.business_id}>{t.name}</option>)}
                            </select>
                        </div>
                        <div className="form-grid">
                            <div className="field"><label htmlFor="salBasic">Basic</label><input id="salBasic" type="number" step="0.01" value={salaryForm.basic} onChange={(e) => setSalaryForm((s) => ({ ...s, basic: e.target.value }))} /></div>
                            <div className="field"><label htmlFor="salHouse">House rent</label><input id="salHouse" type="number" step="0.01" value={salaryForm.houseRent} onChange={(e) => setSalaryForm((s) => ({ ...s, houseRent: e.target.value }))} /></div>
                        </div>
                        <div className="form-grid">
                            <div className="field"><label htmlFor="salMedical">Medical</label><input id="salMedical" type="number" step="0.01" value={salaryForm.medical} onChange={(e) => setSalaryForm((s) => ({ ...s, medical: e.target.value }))} /></div>
                            <div className="field"><label htmlFor="salTransport">Transport</label><input id="salTransport" type="number" step="0.01" value={salaryForm.transport} onChange={(e) => setSalaryForm((s) => ({ ...s, transport: e.target.value }))} /></div>
                        </div>
                        <div className="form-grid">
                            <div className="field"><label htmlFor="salFood">Food</label><input id="salFood" type="number" step="0.01" value={salaryForm.food} onChange={(e) => setSalaryForm((s) => ({ ...s, food: e.target.value }))} /></div>
                            <div className="field"><label htmlFor="salPF">Provident fund %</label><input id="salPF" type="number" step="0.01" value={salaryForm.providentFundPercent} onChange={(e) => setSalaryForm((s) => ({ ...s, providentFundPercent: e.target.value }))} /></div>
                        </div>
                        <div className="form-grid">
                            <div className="field"><label htmlFor="salEffective">Effective date</label><input id="salEffective" type="date" value={salaryForm.effectiveDate} onChange={(e) => setSalaryForm((s) => ({ ...s, effectiveDate: e.target.value }))} /></div>
                            <div className="field"><label htmlFor="salNotes">Notes</label><input id="salNotes" value={salaryForm.notes} onChange={(e) => setSalaryForm((s) => ({ ...s, notes: e.target.value }))} /></div>
                        </div>
                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setSalaryEmployee(null)}>Close</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Set salary'}</button>
                        </div>
                    </form>
                </Modal>
            )}

            {statusEmployee && (
                <Modal title={`Employee status — ${statusEmployee.full_name}`} onClose={() => setStatusEmployee(null)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={handleStatusSubmit}>
                        <div className="field"><label>Status *</label><select required value={statusForm.status} onChange={(e)=>setStatusForm((s)=>({...s,status:e.target.value}))}><option value="active">Active</option><option value="inactive">Inactive</option><option value="on_leave">On leave</option><option value="terminated">Terminated</option></select></div>
                        <div className="field"><label>Effective reason *</label><textarea required value={statusForm.statusReason} onChange={(e)=>setStatusForm((s)=>({...s,statusReason:e.target.value}))} placeholder="Explain why this status is being changed" /></div>
                        <p className="card-subtitle">Inactive and terminated employees remain in payroll, attendance, task, voucher, and audit history but are excluded from new active operations.</p>
                        <div className="form-actions"><button type="button" className="btn btn-secondary" onClick={()=>setStatusEmployee(null)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy?'Saving…':'Save status'}</button></div>
                    </form>
                </Modal>
            )}
        </div>
    );
}
