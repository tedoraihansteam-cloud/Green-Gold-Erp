import { useEffect, useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/apiClient';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { IconPlus } from '../../components/Icons';

const LOGIN_ACCOUNT_TYPES = ['staff', 'customer', 'vendor'];
const EMPTY_ROLE = { name: '', description: '', allowedAccountTypes: ['staff'] };

function AccountTypeChoices({ selected, onToggle }) {
    return (
        <fieldset style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 12, marginBottom: 14 }}>
            <legend style={{ padding: '0 6px', fontWeight: 700 }}>Role available for</legend>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                {LOGIN_ACCOUNT_TYPES.map((accountType) => (
                    <label key={accountType} style={{ display: 'flex', gap: 6, alignItems: 'center', textTransform: 'capitalize', cursor: 'pointer' }}>
                        <input type="checkbox" checked={selected.has(accountType)} onChange={() => onToggle(accountType)} style={{ width: 'auto' }} />
                        {accountType}
                    </label>
                ))}
            </div>
        </fieldset>
    );
}

export default function RolesPage() {
    const { data, loading, error, reload } = useApi('/roles');
    const { data: permissionData } = useApi('/roles/permissions');
    const [showCreate, setShowCreate] = useState(false);
    const [createForm, setCreateForm] = useState(EMPTY_ROLE);
    const [editingRole, setEditingRole] = useState(null);
    const [checked, setChecked] = useState(new Set());
    const [accountTypes, setAccountTypes] = useState(new Set(['staff']));
    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);
    const roles = data?.roles || [];
    const moduleGroups = permissionData?.modules || {};

    useEffect(() => {
        if (editingRole) {
            setChecked(new Set(editingRole.permission_codes));
            setAccountTypes(new Set(editingRole.allowed_account_types || ['staff']));
        }
    }, [editingRole]);

    function toggleSet(setter, value) {
        setter((current) => {
            const next = new Set(current);
            if (next.has(value) && next.size > 1) next.delete(value);
            else next.add(value);
            return next;
        });
    }

    function toggleCreateAccountType(accountType) {
        setCreateForm((current) => {
            const next = new Set(current.allowedAccountTypes);
            if (next.has(accountType) && next.size > 1) next.delete(accountType);
            else next.add(accountType);
            return { ...current, allowedAccountTypes: Array.from(next) };
        });
    }

    async function handleCreate(event) {
        event.preventDefault();
        setBusy(true);
        setFormError('');
        try {
            await api.post('/roles', createForm);
            setShowCreate(false);
            setCreateForm(EMPTY_ROLE);
            reload();
        } catch (createError) {
            setFormError(createError.message);
        } finally {
            setBusy(false);
        }
    }

    function togglePermission(code) {
        setChecked((current) => {
            const next = new Set(current);
            if (next.has(code)) next.delete(code);
            else next.add(code);
            return next;
        });
    }

    function toggleModule(permissions, allChecked) {
        setChecked((current) => {
            const next = new Set(current);
            permissions.forEach((permission) => {
                if (allChecked) next.delete(permission.code);
                else next.add(permission.code);
            });
            return next;
        });
    }

    async function savePermissions() {
        setBusy(true);
        setFormError('');
        try {
            await api.put(`/roles/${editingRole.id}/permissions`, {
                permissionCodes: Array.from(checked),
                allowedAccountTypes: Array.from(accountTypes),
            });
            setEditingRole(null);
            reload();
        } catch (saveError) {
            setFormError(saveError.message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">Roles</h1>
                    <p className="card-subtitle">Configure permissions and choose whether each role is available to staff, customer, or vendor logins.</p>
                </div>
                <button type="button" className="btn btn-primary" onClick={() => { setFormError(''); setShowCreate(true); }}><IconPlus /> New role</button>
            </div>

            <div className="card">
                {error ? <div className="error-banner">{error}</div> : null}
                {loading ? <p style={{ color: 'var(--ink-600)' }}>Loading…</p> : (
                    <DataTable
                        columns={[
                            { key: 'name', label: 'Role' },
                            { key: 'description', label: 'Description' },
                            { key: 'allowed_account_types', label: 'Available for', render: (role) => (role.allowed_account_types || ['staff']).join(', ') },
                            { key: 'permission_codes', label: 'Permissions', render: (role) => role.is_system_role ? <span style={{ color: 'var(--ink-400)' }}>All (system role)</span> : `${role.permission_codes.length} granted` },
                            {
                                key: 'actions',
                                label: '',
                                render: (role) => !role.is_system_role ? (
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingRole(role)}>Edit access</button>
                                ) : null,
                            },
                        ]}
                        rows={roles}
                        emptyMessage="No custom roles yet."
                    />
                )}
            </div>

            {showCreate ? (
                <Modal title="New role" onClose={() => setShowCreate(false)}>
                    {formError ? <div className="error-banner">{formError}</div> : null}
                    <form onSubmit={handleCreate}>
                        <div className="field">
                            <label htmlFor="roleName">Name *</label>
                            <input id="roleName" required value={createForm.name} onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="roleDesc">Description</label>
                            <input id="roleDesc" value={createForm.description} onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))} />
                        </div>
                        <AccountTypeChoices selected={new Set(createForm.allowedAccountTypes)} onToggle={toggleCreateAccountType} />
                        <div className="hint" style={{ marginBottom: 14 }}>Set detailed module permissions after creating the role.</div>
                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create role'}</button>
                        </div>
                    </form>
                </Modal>
            ) : null}

            {editingRole ? (
                <Modal title={`Access — ${editingRole.name}`} onClose={() => setEditingRole(null)} wide>
                    {formError ? <div className="error-banner">{formError}</div> : null}
                    <AccountTypeChoices selected={accountTypes} onToggle={(accountType) => toggleSet(setAccountTypes, accountType)} />
                    <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                        {Object.entries(moduleGroups).map(([moduleCode, group]) => {
                            const allChecked = group.permissions.every((permission) => checked.has(permission.code));
                            return (
                                <div key={moduleCode} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--line)' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, marginBottom: 8, cursor: 'pointer' }}>
                                        <input type="checkbox" checked={allChecked} onChange={() => toggleModule(group.permissions, allChecked)} style={{ width: 'auto' }} />
                                        {group.moduleName}
                                    </label>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', paddingLeft: 24 }}>
                                        {group.permissions.map((permission) => (
                                            <label key={permission.code} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                                                <input type="checkbox" checked={checked.has(permission.code)} onChange={() => togglePermission(permission.code)} style={{ width: 'auto' }} />
                                                {permission.name.split(' - ')[1] || permission.name}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="form-actions">
                        <button type="button" className="btn btn-secondary" onClick={() => setEditingRole(null)}>Cancel</button>
                        <button type="button" className="btn btn-primary" onClick={savePermissions} disabled={busy}>{busy ? 'Saving…' : 'Save access'}</button>
                    </div>
                </Modal>
            ) : null}
        </div>
    );
}
