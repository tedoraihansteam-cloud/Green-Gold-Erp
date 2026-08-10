import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/apiClient';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import Pill from '../../components/Pill';

export default function UsersPage() {
    const { data, loading, error, reload } = useApi('/users');
    const { data: rolesData } = useApi('/roles');
    const [assigning, setAssigning] = useState(null);
    const [roleToAssign, setRoleToAssign] = useState('');
    const [busy, setBusy] = useState(false);

    const users = data?.users || [];
    const roles = rolesData?.roles || [];
    const eligibleRoles = assigning
        ? roles.filter((role) => (role.allowed_account_types || ['staff']).includes(assigning.account_type))
        : [];

    const assignRole = async () => {
        setBusy(true);
        try {
            await api.post(`/users/${assigning.id}/roles`, { roleId: roleToAssign });
            setAssigning(null); setRoleToAssign('');
            reload();
        } catch (err) { alert(err.message); } finally { setBusy(false); }
    };

    const removeRole = async (userId, roleId) => {
        await api.del(`/users/${userId}/roles/${roleId}`);
        reload();
    };

    const disableUser = async (userId) => {
        if (!confirm('Disable this account? They will be logged out immediately.')) return;
        try {
            await api.post(`/users/${userId}/disable`);
            reload();
        } catch (err) { alert(err.message); }
    };

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">Users</h1>
                    <p className="card-subtitle">Every login account — staff, customer, and vendor</p>
                </div>
            </div>

            <div className="card">
                {error && <div className="error-banner">{error}</div>}
                {loading ? <p style={{ color: 'var(--ink-600)' }}>Loading…</p> : (
                    <DataTable
                        columns={[
                            { key: 'username', label: 'Username' },
                            { key: 'account_type', label: 'Type' },
                            { key: 'linked_business_id', label: 'Linked record', render: (r) => r.linked_business_id ? <span><span className="mono">{r.linked_business_id}</span><span className="hint" style={{ display: 'block' }}>{r.linked_record_name}</span></span> : <span className="hint">Not linked</span> },
                            { key: 'status', label: 'Status', render: (r) => <Pill status={r.status} /> },
                            { key: 'roles', label: 'Roles', render: (r) => (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {(r.roles || []).map((roleName) => {
                                        const role = roles.find((x) => x.name === roleName);
                                        return (
                                            <span key={roleName} className="pill pill-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                {roleName}
                                                {role && <button type="button" onClick={() => removeRole(r.id, role.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'inherit', fontSize: 11 }}>✕</button>}
                                            </span>
                                        );
                                    })}
                                </div>
                            )},
                            { key: 'actions', label: '', render: (r) => (
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setAssigning(r); setRoleToAssign(''); }}>Assign role</button>
                                    {r.status === 'active' && <button type="button" className="btn btn-danger btn-sm" onClick={() => disableUser(r.id)}>Disable</button>}
                                </div>
                            )}
                        ]}
                        rows={users}
                        emptyMessage="No users yet."
                    />
                )}
            </div>

            {assigning && (
                <Modal title={`Assign a role to ${assigning.username}`} onClose={() => setAssigning(null)}>
                    <div className="field">
                        <label htmlFor="roleSelect">Role</label>
                        <select id="roleSelect" value={roleToAssign} onChange={(e) => setRoleToAssign(e.target.value)}>
                            <option value="">Select a role…</option>
                            {eligibleRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                        {!eligibleRoles.length && <div className="hint">No role is enabled for {assigning.account_type} accounts. Enable this account type on the Roles page first.</div>}
                    </div>
                    <div className="form-actions">
                        <button type="button" className="btn btn-secondary" onClick={() => setAssigning(null)}>Cancel</button>
                        <button type="button" className="btn btn-primary" disabled={!roleToAssign || busy} onClick={assignRole}>{busy ? 'Assigning…' : 'Assign'}</button>
                    </div>
                </Modal>
            )}
        </div>
    );
}
