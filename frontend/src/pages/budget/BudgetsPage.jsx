import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import Modal from '../../components/Modal';
import { IconPlus } from '../../components/Icons';
import BusinessIdentifier from '../../components/BusinessIdentifier';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const STATUS_COLOR = { ok: 'var(--moss-600)', warning: 'var(--amber-600)', exceeded: 'var(--rust-600)' };

export default function BudgetsPage() {
    const { can } = useAuth();
    const { data, loading, error, reload } = useApi('/budgets');
    const { data: catData } = useApi('/expenses/categories');

    const now = new Date();
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ name: '', categoryId: '', periodType: 'monthly', periodYear: now.getFullYear(), periodMonth: now.getMonth() + 1, amount: '', warningThresholdPercent: '80' });
    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);

    const budgets = data?.budgets || [];
    const categories = catData?.categories || [];

    const handleSubmit = async (e) => {
        e.preventDefault();
        setBusy(true); setFormError('');
        try {
            await api.post('/budgets', { ...form, categoryId: Number(form.categoryId), amount: Number(form.amount), warningThresholdPercent: Number(form.warningThresholdPercent) });
            setShowForm(false);
            reload();
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">Budgets</h1>
                    <p className="card-subtitle">Actual spend is computed live from approved expenses — never stored, never stale</p>
                </div>
                {can('BUDGET_CREATE') && <button type="button" className="btn btn-primary" onClick={() => { setFormError(''); setShowForm(true); }}><IconPlus /> New budget</button>}
            </div>

            {error && <div className="error-banner">{error}</div>}
            {loading && <p style={{ color: 'var(--ink-600)' }}>Loading…</p>}

            {!loading && budgets.length === 0 && (
                <div className="card empty-state"><h3>No budgets yet</h3><p>Create one against an expense category to start tracking variance.</p></div>
            )}

            <div className="stat-grid">
                {budgets.map((b) => (
                    <div className="card" key={b.id} style={{ marginBottom: 0 }}>
                        <BusinessIdentifier entityType="BUDGET" businessId={b.business_id} />
                        <div className="card-subtitle" style={{ marginBottom: 2 }}>{b.category_name} · {b.period_type === 'monthly' ? `${MONTHS[b.period_month - 1]} ${b.period_year}` : b.period_year}</div>
                        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 15, margin: '0 0 10px' }}>{b.name}</h2>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
                            <span>৳{Number(b.actual_spend).toLocaleString()} spent</span>
                            <span style={{ color: 'var(--ink-600)' }}>of ৳{Number(b.amount).toLocaleString()}</span>
                        </div>
                        <div style={{ height: 8, background: 'var(--paper)', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--line)' }}>
                            <div style={{ height: '100%', width: `${Math.min(b.percent_used, 100)}%`, background: STATUS_COLOR[b.status] }} />
                        </div>
                        <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: STATUS_COLOR[b.status] }}>
                            {b.percent_used}% used {b.status === 'exceeded' ? `— over by ৳${Math.abs(Number(b.variance)).toLocaleString()}` : ''}
                        </div>
                    </div>
                ))}
            </div>

            {showForm && (
                <Modal title="New budget" onClose={() => setShowForm(false)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={handleSubmit}>
                        <div className="field">
                            <label htmlFor="budName">Name *</label>
                            <input id="budName" required value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
                        </div>
                        <div className="field">
                            <label htmlFor="budCategory">Expense category *</label>
                            <select id="budCategory" required value={form.categoryId} onChange={(e) => setForm((s) => ({ ...s, categoryId: e.target.value }))}>
                                <option value="">Select…</option>
                                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="budPeriodType">Period *</label>
                                <select id="budPeriodType" value={form.periodType} onChange={(e) => setForm((s) => ({ ...s, periodType: e.target.value }))}>
                                    <option value="monthly">Monthly</option>
                                    <option value="yearly">Yearly</option>
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="budYear">Year</label>
                                <input id="budYear" type="number" value={form.periodYear} onChange={(e) => setForm((s) => ({ ...s, periodYear: Number(e.target.value) }))} />
                            </div>
                        </div>
                        {form.periodType === 'monthly' && (
                            <div className="field">
                                <label htmlFor="budMonth">Month</label>
                                <select id="budMonth" value={form.periodMonth} onChange={(e) => setForm((s) => ({ ...s, periodMonth: Number(e.target.value) }))}>
                                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                                </select>
                            </div>
                        )}
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="budAmount">Budget amount (৳) *</label>
                                <input id="budAmount" type="number" step="0.01" required value={form.amount} onChange={(e) => setForm((s) => ({ ...s, amount: e.target.value }))} />
                            </div>
                            <div className="field">
                                <label htmlFor="budWarn">Warning at %</label>
                                <input id="budWarn" type="number" step="1" value={form.warningThresholdPercent} onChange={(e) => setForm((s) => ({ ...s, warningThresholdPercent: e.target.value }))} />
                            </div>
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
