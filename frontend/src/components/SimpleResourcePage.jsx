import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../lib/useApi';
import { api } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
import DataTable from './DataTable';
import Modal from './Modal';
import { IconPlus } from './Icons';
import { BatchIdentifierDownload } from './DocumentActions';

/**
 * Renders a title + "New" button + table, and a create-form modal, driven
 * entirely by config. Used for every module whose create flow is just
 * "fill a flat form, POST it, refresh the list" - which covers most of
 * the master-data modules. Modules with multi-step or special workflows
 * (invoices, cold storage billing, gate pass scanning) have their own
 * bespoke pages instead of using this.
 */
export default function SimpleResourcePage({
    title, subtitle, listPath, listKey, createPath, createPermission, columns,
    formFields, transformSubmit, emptyMessage, extraHeaderContent, entityType
}) {
    const { can } = useAuth();
    const { data, loading, error, reload } = useApi(listPath);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(() => Object.fromEntries((formFields || []).map((f) => [f.name, f.default || ''])));
    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);
    const [searchParams, setSearchParams] = useSearchParams();

    const rows = data ? data[listKey] || [] : [];
    const canCreate = createPath && (!createPermission || can(createPermission));

    const openForm = () => {
        setForm(Object.fromEntries((formFields || []).map((f) => [f.name, f.default || ''])));
        setFormError('');
        setShowForm(true);
    };
    useEffect(() => {
        if (canCreate && searchParams.get('create') === '1') { openForm(); setSearchParams({}, { replace: true }); }
    }, [canCreate, searchParams, setSearchParams]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setBusy(true);
        setFormError('');
        try {
            const body = transformSubmit ? transformSubmit(form) : form;
            await api.post(createPath, body);
            setShowForm(false);
            reload();
        } catch (err) {
            setFormError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">{title}</h1>
                    {subtitle && <p className="card-subtitle">{subtitle}</p>}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                    {extraHeaderContent}
                    {entityType && <BatchIdentifierDownload entityType={entityType} rows={rows} />}
                    {canCreate && (
                        <button type="button" className="btn btn-primary" onClick={openForm}>
                            <IconPlus /> New
                        </button>
                    )}
                </div>
            </div>

            <div className="card">
                {error && <div className="error-banner">{error}</div>}
                {loading ? <p style={{ color: 'var(--ink-600)' }}>Loading…</p> : (
                    <DataTable columns={columns} rows={rows} emptyMessage={emptyMessage || 'Nothing here yet.'} />
                )}
            </div>

            {showForm && (
                <Modal title={`New ${title.replace(/s$/, '')}`} onClose={() => setShowForm(false)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={handleSubmit}>
                        <div className="form-grid">
                            {formFields.map((f) => (
                                <div className="field" key={f.name} style={f.fullWidth ? { gridColumn: '1 / -1' } : undefined}>
                                    <label htmlFor={f.name}>{f.label}{f.required && ' *'}</label>
                                    {f.type === 'select' ? (
                                        <select id={f.name} value={form[f.name]} required={f.required}
                                            onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))}>
                                            <option value="">{f.placeholder || 'Select…'}</option>
                                            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                    ) : f.type === 'textarea' ? (
                                        <textarea id={f.name} rows={3} value={form[f.name]} required={f.required}
                                            onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))} />
                                    ) : (
                                        <input id={f.name} type={f.type || 'text'} value={form[f.name]} required={f.required}
                                            placeholder={f.placeholder} step={f.step}
                                            onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))} />
                                    )}
                                    {f.hint && <div className="hint">{f.hint}</div>}
                                </div>
                            ))}
                        </div>
                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    );
}
