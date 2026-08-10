import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import Modal from '../../components/Modal';
import { IconPlus } from '../../components/Icons';

export default function NoticesPage() {
    const { can } = useAuth();
    const { data, loading, error, reload } = useApi('/notices');
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ title: '', body: '', targetType: 'all' });
    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);

    const notices = data?.notices || [];

    const handleSubmit = async (e) => {
        e.preventDefault();
        setBusy(true); setFormError('');
        try {
            await api.post('/notices', form);
            setShowForm(false);
            setForm({ title: '', body: '', targetType: 'all' });
            reload();
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    const markRead = async (id) => { await api.post(`/notices/${id}/read`); reload(); };

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">Notices</h1>
                    <p className="card-subtitle">One-way announcements — no chat, just what you need to know</p>
                </div>
                {can('NOTICES_CREATE') && <button type="button" className="btn btn-primary" onClick={() => { setFormError(''); setShowForm(true); }}><IconPlus /> New notice</button>}
            </div>

            {error && <div className="error-banner">{error}</div>}
            {loading && <p style={{ color: 'var(--ink-600)' }}>Loading…</p>}

            {!loading && notices.length === 0 && (
                <div className="card empty-state"><h3>No notices</h3><p>Nothing has been posted yet.</p></div>
            )}

            {notices.map((n) => (
                <div className="card" key={n.id} style={{ borderLeft: n.read_at ? undefined : '3px solid var(--husk-600)' }}>
                    <div className="card-header">
                        <div>
                            <h2>{n.title}</h2>
                            <p className="card-subtitle">{new Date(n.created_at).toLocaleString()} · targeted: {n.target_type}</p>
                        </div>
                        {!n.read_at && <button type="button" className="btn btn-secondary btn-sm" onClick={() => markRead(n.id)}>Mark read</button>}
                    </div>
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{n.body}</p>
                </div>
            ))}

            {showForm && (
                <Modal title="New notice" onClose={() => setShowForm(false)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={handleSubmit}>
                        <div className="field">
                            <label htmlFor="noticeTitle">Title *</label>
                            <input id="noticeTitle" required value={form.title} onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="noticeBody">Message *</label>
                            <textarea id="noticeBody" rows={4} required value={form.body} onChange={(e) => setForm((s) => ({ ...s, body: e.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="noticeTarget">Audience</label>
                            <select id="noticeTarget" value={form.targetType} onChange={(e) => setForm((s) => ({ ...s, targetType: e.target.value }))}>
                                <option value="all">Everyone</option>
                                <option value="staff">Staff only</option>
                                <option value="customer">Customers only</option>
                                <option value="vendor">Vendors only</option>
                            </select>
                        </div>
                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Posting…' : 'Post notice'}</button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    );
}
