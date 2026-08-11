import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import Pill from '../../components/Pill';

const label = (value) => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const displayValue = (value) => value == null || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const importantRecordFields = ['business_id', 'name', 'full_name', 'title', 'status', 'payment_status', 'amount', 'total', 'created_at', 'deleted_at'];
function ObjectDetails({ value, empty = 'No values supplied.' }) {
    const entries = Object.entries(value || {}).filter(([, item]) => item !== undefined);
    if (!entries.length) return <p className="hint">{empty}</p>;
    return <div className="detail-grid">{entries.map(([key, item]) => <div className="detail-item" key={key}><span>{label(key)}</span><strong>{displayValue(item)}</strong></div>)}</div>;
}

export default function DataCorrectionsPage() {
    const { can } = useAuth(), [params] = useSearchParams();
    const { data: meta } = useApi('/data-corrections/metadata'), { data, reload } = useApi('/data-corrections');
    const [show, setShow] = useState(false), [selected, setSelected] = useState(null);
    const [form, setForm] = useState({ entityType: 'CUSTOMER', entityBusinessId: '', operation: 'EDIT', reason: '', proposedChanges: {} });
    const [error, setError] = useState(''), [message, setMessage] = useState(''), [reviewNotes, setReviewNotes] = useState(''), [moduleNotes, setModuleNotes] = useState(''), [busy, setBusy] = useState(false);
    const { data: detail, reload: reloadDetail } = useApi(selected ? `/data-corrections/${selected}` : null);
    const entities = meta?.entities || [], entity = entities.find((item) => item.type === form.entityType);
    const recordSummary = useMemo(() => {
        const record = detail?.targetRecord || {};
        const selectedFields = importantRecordFields.filter((key) => Object.prototype.hasOwnProperty.call(record, key));
        return Object.fromEntries(selectedFields.map((key) => [key, record[key]]));
    }, [detail]);

    useEffect(() => { const type = params.get('entityType'), id = params.get('entityId'); if (type && id) { setForm((current) => ({ ...current, entityType: type, entityBusinessId: id })); setShow(true); } }, [params]);
    useEffect(() => { setReviewNotes(''); setModuleNotes(''); setMessage(''); }, [selected]);
    const setField = (name, value) => setForm((current) => ({ ...current, proposedChanges: { ...current.proposedChanges, [name]: value } }));
    const changeEntity = (type) => { const next = entities.find((item) => item.type === type); setForm((current) => ({ ...current, entityType: type, operation: next?.allowedActions?.[0] || 'EDIT', proposedChanges: {} })); };
    async function submit(event) {
        event.preventDefault(); setBusy(true);
        try { setError(''); await api.post('/data-corrections', form); setShow(false); setForm({ entityType: 'CUSTOMER', entityBusinessId: '', operation: 'EDIT', reason: '', proposedChanges: {} }); setMessage('Correction request submitted for approval.'); reload(); }
        catch (requestError) { setError(requestError.message); }
        finally { setBusy(false); }
    }
    async function review(decision) {
        if (!reviewNotes.trim()) return setMessage('Review remarks are required.'); setBusy(true);
        try { const result = await api.post(`/data-corrections/${selected}/review`, { decision, notes: reviewNotes }); setMessage(decision === 'approve' ? 'Request approved. The authorized module action is now ready to apply.' : 'Request rejected.'); setReviewNotes(''); reload(); reloadDetail(); return result; }
        catch (requestError) { setMessage(requestError.message); }
        finally { setBusy(false); }
    }
    async function applyAction() {
        if (!moduleNotes.trim()) return setMessage('Module action remarks are required.'); setBusy(true);
        try { const result = await api.post(`/data-corrections/${selected}/apply`, { notes: moduleNotes }); setMessage(result.message); setModuleNotes(''); reload(); reloadDetail(); }
        catch (requestError) { setMessage(requestError.message); }
        finally { setBusy(false); }
    }

    return <div>
        <div className="card-header"><div><h1 className="page-title">Data correction center</h1><p className="card-subtitle">Request, approve and apply controlled edits, soft deletion, restoration, cancellation and reversal without erasing audit history.</p></div>{can('USER_MANAGEMENT_EDIT') && <button className="btn btn-primary" onClick={() => setShow(true)}>New correction request</button>}</div>
        {message && !selected && <div className="success-banner">{message}</div>}
        <div className="card"><DataTable rows={data?.requests || []} emptyMessage="No correction requests." columns={[{ key: 'business_id', label: 'Request' }, { key: 'entity_type', label: 'Module / record type', render: (row) => label(row.entity_type) }, { key: 'entity_business_id', label: 'Record ID' }, { key: 'operation', label: 'Requested action' }, { key: 'effective_operation', label: 'Effective action', render: (row) => row.effective_operation || row.operation }, { key: 'reason', label: 'Reason' }, { key: 'requested_by_username', label: 'Requested by' }, { key: 'status', label: 'Status', render: (row) => <Pill status={row.status} /> }, { key: 'actions', label: '', render: (row) => <button className="btn btn-secondary btn-sm" onClick={() => setSelected(row.business_id)}>Open / review</button> }]} /></div>

        {show && <Modal title="Request data correction" onClose={() => setShow(false)} wide>
            {error && <div className="error-banner">{error}</div>}
            <form onSubmit={submit}>
                <div className="form-grid"><div className="field"><label>Module / record type *</label><select required value={form.entityType} onChange={(event) => changeEntity(event.target.value)}>{entities.map((item) => <option value={item.type} key={item.type}>{label(item.type)}</option>)}</select></div><div className="field"><label>Record business ID *</label><input required placeholder="Example: CUS-BD-DHK-2026-000001" value={form.entityBusinessId} onChange={(event) => setForm({ ...form, entityBusinessId: event.target.value })} /></div><div className="field"><label>Requested action *</label><select value={form.operation} onChange={(event) => setForm({ ...form, operation: event.target.value })}>{(entity?.allowedActions || ['EDIT']).map((action) => <option value={action} key={action}>{label(action)}</option>)}</select></div></div>
                {entity?.protected && <div className="info-banner">Posted records are never physically erased. Delete is converted to the module’s safe cancellation or reversal action.</div>}
                {form.operation === 'EDIT' && <div className="card"><h3>Proposed field values</h3><p className="card-subtitle">Enter only the fields that need changing. Every previous value remains in the audit trail.</p><div className="form-grid">{(entity?.editableFields || []).map((field) => <div className="field" key={field}><label>{label(field)}</label><input value={form.proposedChanges[field] ?? ''} onChange={(event) => setField(field, event.target.value)} /></div>)}</div></div>}
                <div className="field"><label>Mandatory correction reason *</label><textarea required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Explain what is wrong, why this action is required and any operational impact." /></div>
                <div className="form-actions"><button type="button" className="btn btn-secondary" onClick={() => setShow(false)}>Close</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit for approval'}</button></div>
            </form>
        </Modal>}

        {selected && detail?.request && <Modal title={`${detail.request.business_id} — ${label(detail.request.operation)}`} onClose={() => setSelected(null)} wide>
            {message && <div className={/success|approved|ready|applied|rejected/i.test(message) ? 'success-banner' : 'error-banner'}>{message}</div>}
            <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}><div className="stat-card"><div className="label">Record</div><div className="value" style={{ fontSize: 18 }}>{detail.request.entity_business_id}</div><small>{label(detail.request.entity_type)}</small></div><div className="stat-card"><div className="label">Requested action</div><div className="value" style={{ fontSize: 18 }}>{label(detail.request.operation)}</div></div><div className="stat-card"><div className="label">Effective module action</div><div className="value" style={{ fontSize: 18 }}>{label(detail.moduleAction?.effectiveOperation || detail.request.effective_operation || detail.request.operation)}</div></div><div className="stat-card"><div className="label">Status</div><div style={{ marginTop: 10 }}><Pill status={detail.request.status} /></div></div><div className="stat-card"><div className="label">Requested by</div><div className="value" style={{ fontSize: 18 }}>{detail.request.requested_by_username}</div></div></div>

            <div className="card" style={{ marginTop: 14 }}><h3>Request and record details</h3><p><strong>Reason:</strong> {detail.request.reason}</p><ObjectDetails value={recordSummary} empty="The target record is no longer available." /></div>
            {detail.request.operation === 'EDIT' && <div className="card"><h3>Approved proposed changes</h3><ObjectDetails value={detail.request.proposed_changes} /></div>}

            <div className="card"><h3>Dependency and impact check</h3><p className="card-subtitle">Warnings preserve linked history. Blocking dependencies must be resolved before the action can be applied.</p>{(detail.dependencies || []).length ? <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>{detail.dependencies.map((item) => <div className="stat-card" key={item.label}><div className="label">{item.label}</div><div className="value" style={{ fontSize: 20 }}>{Number(item.count || 0).toLocaleString()}</div><Pill status={item.blocking ? 'blocked' : item.count ? 'warning' : 'clear'} /></div>)}</div> : <div className="success-banner">No blocking dependencies were detected for this module action.</div>}</div>

            {detail.request.review_notes && <div className="card"><h3>Approval review</h3><p>{detail.request.review_notes}</p><div className="hint">Reviewed by {detail.request.reviewed_by_username || 'authorized reviewer'} {detail.request.reviewed_at ? `on ${new Date(detail.request.reviewed_at).toLocaleString()}` : ''}</div></div>}
            {detail.request.status === 'submitted' && can('USER_MANAGEMENT_APPROVE') && <div className="card"><h3>Review and approval</h3><div className="field"><label>Mandatory review remarks *</label><textarea value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} placeholder="Record your verification and approval decision." /></div><div className="form-actions"><button className="btn btn-danger" disabled={busy} onClick={() => review('reject')}>Reject request</button><button className="btn btn-primary" disabled={busy} onClick={() => review('approve')}>{busy ? 'Processing…' : 'Approve for module action'}</button></div></div>}
            {detail.request.status === 'module_action_required' && can('USER_MANAGEMENT_APPROVE') && <div className="card"><h3>Apply authorized module action</h3><p>The approval is complete. Apply <strong>{label(detail.moduleAction?.effectiveOperation)}</strong> to the {label(detail.request.entity_type)} record. The original record and this request remain permanently auditable.</p>{(detail.dependencies || []).some((item) => item.blocking) && <div className="error-banner">Resolve the blocking dependencies above before applying this action.</div>}<div className="field"><label>Mandatory implementation remarks *</label><textarea value={moduleNotes} onChange={(event) => setModuleNotes(event.target.value)} placeholder="Describe the checks completed before applying the module action." /></div><div className="form-actions"><button className="btn btn-primary" disabled={busy || (detail.dependencies || []).some((item) => item.blocking)} onClick={applyAction}>{busy ? 'Applying…' : `Apply ${label(detail.moduleAction?.effectiveOperation)}`}</button></div></div>}
            {detail.request.status === 'applied' && <div className="success-banner"><strong>Module action applied.</strong><div>{detail.request.module_action_notes || 'The approved action was completed and retained in the audit trail.'}</div><div className="hint">Applied by {detail.request.applied_by_username || 'authorized person'} {detail.request.applied_at ? `on ${new Date(detail.request.applied_at).toLocaleString()}` : ''}</div></div>}

            <h3>Permanent record audit history</h3>
            <DataTable rows={detail.recordHistory || []} emptyMessage="No earlier audit entries." columns={[{ key: 'created_at', label: 'Date', render: (row) => new Date(row.created_at).toLocaleString() }, { key: 'action', label: 'Action', render: (row) => label(row.action) }, { key: 'actor_username', label: 'Person', render: (row) => row.actor_username || 'System' }, { key: 'before_data', label: 'Previous summary', render: (row) => <span title={JSON.stringify(row.before_data || {})}>{Object.keys(row.before_data || {}).slice(0, 5).map((key) => `${label(key)}: ${displayValue(row.before_data[key])}`).join(' · ') || '—'}</span> }, { key: 'after_data', label: 'New summary', render: (row) => <span title={JSON.stringify(row.after_data || {})}>{Object.keys(row.after_data || {}).slice(0, 5).map((key) => `${label(key)}: ${displayValue(row.after_data[key])}`).join(' · ') || '—'}</span> }]} />
        </Modal>}
    </div>;
}
