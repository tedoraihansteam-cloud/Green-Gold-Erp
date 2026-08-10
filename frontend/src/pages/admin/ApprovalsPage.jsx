import { useEffect, useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/apiClient';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';

export default function ApprovalsPage() {
    const { data, loading, error, reload } = useApi('/auth/pending-approvals');
    const [selected, setSelected] = useState(null);
    const { data: optionData, loading: optionsLoading, error: optionsError } = useApi(
        selected ? `/auth/pending-approvals/${selected.id}/link-options` : null
    );
    const [masterBusinessId, setMasterBusinessId] = useState('');
    const [roleIds, setRoleIds] = useState(new Set());
    const [notes, setNotes] = useState('');
    const [busy, setBusy] = useState(false);
    const [formError, setFormError] = useState('');
    const requests = data?.approvals || [];

    useEffect(() => {
        const suggestedRecord = (optionData?.records || []).find(
            (record) => record.business_id === optionData?.suggestedBusinessId
        );
        setMasterBusinessId(suggestedRecord && !suggestedRecord.linked_username ? suggestedRecord.business_id : '');
    }, [selected?.id, optionData]);

    function openApproval(request) {
        setSelected(request);
        setMasterBusinessId('');
        setRoleIds(new Set());
        setNotes('');
        setFormError('');
    }

    function closeApproval() {
        setSelected(null);
        setFormError('');
    }

    function toggleRole(roleId) {
        setRoleIds((current) => {
            const next = new Set(current);
            if (next.has(roleId)) next.delete(roleId);
            else next.add(roleId);
            return next;
        });
    }

    async function approve() {
        setBusy(true);
        setFormError('');
        try {
            await api.post(`/auth/pending-approvals/${selected.id}/review`, {
                decision: 'approve',
                masterBusinessId: masterBusinessId || undefined,
                roleIds: Array.from(roleIds),
                notes: notes || undefined,
            });
            closeApproval();
            reload();
        } catch (approvalError) {
            setFormError(approvalError.message);
        } finally {
            setBusy(false);
        }
    }

    async function reject(request) {
        const rejectionNotes = window.prompt('Reason for rejecting?') || '';
        try {
            await api.post(`/auth/pending-approvals/${request.id}/review`, {
                decision: 'reject',
                notes: rejectionNotes,
            });
            reload();
        } catch (reviewError) {
            window.alert(reviewError.message);
        }
    }

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">Access approvals</h1>
                    <p className="card-subtitle">Manually link each registration to an existing employee, customer, or vendor record and assign compatible roles.</p>
                </div>
            </div>

            <div className="card">
                {error ? <div className="error-banner">{error}</div> : null}
                {loading ? <p style={{ color: 'var(--ink-600)' }}>Loading…</p> : (
                    <DataTable
                        columns={[
                            { key: 'username', label: 'Username' },
                            { key: 'email', label: 'Email' },
                            { key: 'account_type', label: 'Account type' },
                            {
                                key: 'master_type',
                                label: 'Requested link',
                                render: (row) => (
                                    <span className="mono">
                                        {row.master_type ? `${row.master_type}: ${row.master_business_id}` : 'Not selected during registration'}
                                    </span>
                                ),
                            },
                            { key: 'created_at', label: 'Requested', render: (row) => new Date(row.created_at).toLocaleString() },
                            {
                                key: 'actions',
                                label: '',
                                render: (row) => (
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openApproval(row)}>Review & link</button>
                                        <button type="button" className="btn btn-danger btn-sm" onClick={() => reject(row)}>Reject</button>
                                    </div>
                                ),
                            },
                        ]}
                        rows={requests}
                        emptyMessage="Nothing pending — all caught up."
                    />
                )}
            </div>

            {selected ? (
                <Modal title={`Approve and link — ${selected.username}`} onClose={closeApproval} wide>
                    {optionsError ? <div className="error-banner">{optionsError}</div> : null}
                    {formError ? <div className="error-banner">{formError}</div> : null}
                    {optionsLoading ? <p>Loading available records…</p> : (
                        <>
                            <div className="field">
                                <label htmlFor="master-record">
                                    Existing {optionData?.masterType || selected.account_type} record {optionData?.linkRequired ? '*' : '(optional)'}
                                </label>
                                <select
                                    id="master-record"
                                    required={optionData?.linkRequired}
                                    value={masterBusinessId}
                                    onChange={(event) => setMasterBusinessId(event.target.value)}
                                >
                                    <option value="">{optionData?.linkRequired ? 'Select a record…' : 'Approve without a master-record link'}</option>
                                    {(optionData?.records || []).map((record) => (
                                        <option key={record.business_id} value={record.business_id} disabled={Boolean(record.linked_username)}>
                                            {record.business_id} — {record.name}{record.phone ? ` — ${record.phone}` : ''}{record.linked_username ? ` — already linked to ${record.linked_username}` : ''}
                                        </option>
                                    ))}
                                </select>
                                <div className="hint">The selected record determines which customer, vendor, or employee data this login can access.</div>
                            </div>

                            <fieldset style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 12, margin: '16px 0' }}>
                                <legend style={{ padding: '0 6px', fontWeight: 700 }}>Roles and permissions</legend>
                                {(optionData?.roles || []).length ? optionData.roles.map((role) => (
                                    <label key={role.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 9, cursor: 'pointer' }}>
                                        <input
                                            type="checkbox"
                                            checked={roleIds.has(role.id)}
                                            onChange={() => toggleRole(role.id)}
                                            style={{ width: 'auto', marginTop: 3 }}
                                        />
                                        <span><strong>{role.name}</strong>{role.description ? <span className="hint" style={{ display: 'block' }}>{role.description}</span> : null}</span>
                                    </label>
                                )) : (
                                    <div className="hint">No role is currently enabled for this account type. You may link and approve now, then configure a compatible role on the Roles page.</div>
                                )}
                            </fieldset>

                            <div className="field">
                                <label htmlFor="approval-notes">Approval notes</label>
                                <textarea id="approval-notes" rows="3" value={notes} onChange={(event) => setNotes(event.target.value)} />
                            </div>
                            <div className="form-actions">
                                <button type="button" className="btn btn-secondary" onClick={closeApproval}>Cancel</button>
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    disabled={busy || optionsLoading || (optionData?.linkRequired && !masterBusinessId)}
                                    onClick={approve}
                                >
                                    {busy ? 'Approving…' : 'Link and approve account'}
                                </button>
                            </div>
                        </>
                    )}
                </Modal>
            ) : null}
        </div>
    );
}
