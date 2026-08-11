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
import { BatchIdentifierDownload } from '../../components/DocumentActions';
import IdentityCardPanel from '../../components/IdentityCardPanel';

const PASS_TYPES = [
    { value: 'VISITOR', label: 'Visitor' },
    { value: 'CONTRACTOR', label: 'Contractor' },
    { value: 'MACHINE_MOVEMENT', label: 'Machine movement' },
    { value: 'EMPLOYEE_ASSET', label: 'Employee asset' },
    { value: 'INWARD_GOODS', label: 'Inward goods' }
];

export default function GatePassesPage() {
    const [searchParams,setSearchParams]=useSearchParams();
    const { can } = useAuth();
    const { data, loading, error, reload } = useApi('/security/gate-passes');
    const { data: context } = useApi('/security/gate-passes-context');
    const [showForm, setShowForm] = useState(false);
    const emptyForm={ passType: 'VISITOR', description: '', vehicleNumber: '', contactName: '', contactPhone: '', affiliatedEntityType:'', affiliatedEntityBusinessId:'', affiliatedOrganizationName:'', hostName:'', visitLocation:'', validUntil:'' };
    const [form, setForm] = useState(emptyForm);
    const [cardPass,setCardPass]=useState(null);
    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(()=>{if(searchParams.get('create')==='1'&&can('SECURITY_CREATE')){setShowForm(true);setSearchParams({}, {replace:true})}},[searchParams,setSearchParams,can]);

    const gatePasses = data?.gatePasses || [];

    const handleSubmit = async (e) => {
        e.preventDefault();
        setBusy(true); setFormError('');
        try {
            await api.post('/security/gate-passes', form);
            setShowForm(false);
            setForm(emptyForm);
            reload();
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    const confirmExit = async (businessId) => {
        const exitNote = prompt('Exit note / security remark (required)')?.trim();
        if (!exitNote) return;
        try { setFormError(''); await api.post(`/security/gate-passes/${businessId}/confirm-exit`, { exitNote }); reload(); }
        catch (err) { setFormError(err.message); }
    };
    const cancelPass = async (businessId) => {
        const reason = prompt('Reason for cancelling this gate pass?') || '';
        await api.post(`/security/gate-passes/${businessId}/cancel`, { reason });
        reload();
    };

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">Gate passes</h1>
                    <p className="card-subtitle">Outward goods passes generate automatically from invoices — this is for visitors, contractors, and everything else</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}><BatchIdentifierDownload entityType="GATE_PASS" rows={gatePasses} />{can('SECURITY_CREATE') && <button type="button" className="btn btn-primary" onClick={() => { setFormError(''); setShowForm(true); }}><IconPlus /> New pass</button>}</div>
            </div>

            <div className="card">
                {error && <div className="error-banner">{error}</div>}
                {loading ? <p style={{ color: 'var(--ink-600)' }}>Loading…</p> : (
                    <DataTable
                        columns={[
                            { key: 'business_id', label: 'ID', render: (r) => <BusinessIdentifier entityType="GATE_PASS" businessId={r.business_id} /> },
                            { key: 'pass_type', label: 'Type', render: (r) => r.pass_type.replace(/_/g, ' ') },
                            { key: 'description', label: 'Description' },
                            { key: 'contact_name', label: 'Visitor / contact', render:r=><span>{r.contact_name||'—'}<small style={{display:'block'}}>{r.contact_phone||''}{r.affiliated_organization_name?` · ${r.affiliated_organization_name}`:''}</small></span> },
                            { key: 'status', label: 'Status', render: (r) => <Pill status={r.status} /> },
                            { key: 'actions', label: '', render: (r) => r.status === 'issued' && can('SECURITY_APPROVE') ? (
                                <div style={{ display: 'flex', gap: 6 }}>
                                    {r.pass_type==='VISITOR'&&<button type="button" className="btn btn-secondary btn-sm" onClick={()=>setCardPass(r)}>Visitor card</button>}
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => confirmExit(r.business_id)}>Confirm exit</button>
                                    <button type="button" className="btn btn-danger btn-sm" onClick={() => cancelPass(r.business_id)}>Cancel</button>
                                </div>
                            ) : null }
                        ]}
                        rows={gatePasses}
                        emptyMessage="No gate passes yet."
                    />
                )}
            </div>

            {showForm && (
                <Modal title="New gate pass" onClose={() => setShowForm(false)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={handleSubmit}>
                        <div className="field">
                            <label htmlFor="passType">Type *</label>
                            <select id="passType" value={form.passType} onChange={(e) => setForm((s) => ({ ...s, passType: e.target.value }))}>
                                {PASS_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="passDesc">Description *</label>
                            <input id="passDesc" required placeholder="e.g. Fertilizer supplier meeting with procurement" value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} />
                        </div>
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="passContact">{form.passType==='VISITOR'?'Visitor name *':'Contact name'}</label>
                                <input id="passContact" required={form.passType==='VISITOR'} value={form.contactName} onChange={(e) => setForm((s) => ({ ...s, contactName: e.target.value }))} />
                            </div>
                            <div className="field">
                                <label htmlFor="passPhone">{form.passType==='VISITOR'?'Visitor phone *':'Phone'}</label>
                                <input id="passPhone" required={form.passType==='VISITOR'} value={form.contactPhone} onChange={(e) => setForm((s) => ({ ...s, contactPhone: e.target.value }))} />
                            </div>
                        </div>
                        {form.passType==='VISITOR'&&<><div className="form-grid"><div className="field"><label>Affiliation</label><select value={form.affiliatedEntityType} onChange={e=>setForm(s=>({...s,affiliatedEntityType:e.target.value,affiliatedEntityBusinessId:'',affiliatedOrganizationName:''}))}><option value="">Independent visitor</option><option value="CUSTOMER">Customer representative</option><option value="VENDOR">Vendor representative</option><option value="EMPLOYEE">Referred by employee</option><option value="OTHER_ORGANIZATION">Other organization</option></select></div>{['CUSTOMER','VENDOR','EMPLOYEE'].includes(form.affiliatedEntityType)&&<div className="field"><label>Select linked entity *</label><select required value={form.affiliatedEntityBusinessId} onChange={e=>setForm(s=>({...s,affiliatedEntityBusinessId:e.target.value}))}><option value="">Select...</option>{(context?.[form.affiliatedEntityType.toLowerCase()+'s']||[]).map(x=><option key={x.business_id} value={x.business_id}>{x.business_id} — {x.name}</option>)}</select></div>}{form.affiliatedEntityType==='OTHER_ORGANIZATION'&&<div className="field"><label>Organization name *</label><input required value={form.affiliatedOrganizationName} onChange={e=>setForm(s=>({...s,affiliatedOrganizationName:e.target.value}))}/></div>}</div><div className="form-grid"><div className="field"><label>Host / person to meet</label><input value={form.hostName} onChange={e=>setForm(s=>({...s,hostName:e.target.value}))}/></div><div className="field"><label>Visit location</label><input value={form.visitLocation} onChange={e=>setForm(s=>({...s,visitLocation:e.target.value}))}/></div></div><div className="field"><label>Pass valid until</label><input type="datetime-local" value={form.validUntil} onChange={e=>setForm(s=>({...s,validUntil:e.target.value}))}/></div></>}
                        <div className="field">
                            <label htmlFor="passVehicle">Vehicle number</label>
                            <input id="passVehicle" value={form.vehicleNumber} onChange={(e) => setForm((s) => ({ ...s, vehicleNumber: e.target.value }))} />
                        </div>
                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create pass'}</button>
                        </div>
                    </form>
                </Modal>
            )}
            {cardPass&&<Modal title={`Visitor card — ${cardPass.contact_name}`} onClose={()=>setCardPass(null)}><IdentityCardPanel entityType="GATE_PASS" record={cardPass} name={cardPass.contact_name} onUpdated={reload}/></Modal>}
        </div>
    );
}
