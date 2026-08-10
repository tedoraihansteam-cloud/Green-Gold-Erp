import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/apiClient';
import { IconGrain } from '../components/Icons';

export default function RegisterPage() {
    const [companyId, setCompanyId] = useState(null);
    const [form, setForm] = useState({ username: '', email: '', password: '', accountType: 'staff', masterBusinessId: '' });
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        api.get('/org/public-info').then((d) => setCompanyId(d.company.id)).catch(() => {});
    }, []);

    const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
            const data = await api.post('/auth/register', { ...form, companyId });
            setResult(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    if (result) {
        return (
            <div className="login-screen">
                <div className="login-card">
                    <span className="wordmark on-light"><IconGrain /><span className="green">Green</span> <span className="gold">Gold</span></span>
                    <div className="success-banner" style={{ marginTop: 18 }}>
                        Registration received. An administrator needs to approve your account before you can sign in
                        {result.linkRequest ? ' and link it to your existing record.' : '.'}
                    </div>
                    <Link to="/login" className="btn btn-secondary" style={{ width: '100%', marginTop: 6 }}>Back to sign in</Link>
                </div>
            </div>
        );
    }

    const idLabel = { staff: 'Employee ID (optional, e.g. EMP-HR-2026-000001)', customer: 'Customer ID (optional, e.g. CUS-BD-DHK-2026-000001)', vendor: 'Vendor ID (optional, e.g. VEN-BD-2026-000001)' }[form.accountType];

    return (
        <div className="login-screen">
            <div className="login-card" style={{ maxWidth: 420 }}>
                <span className="wordmark on-light"><IconGrain /><span className="green">Green</span> <span className="gold">Gold</span></span>
                <p className="login-tagline">Request access — an admin must approve before you can sign in.</p>
                {error && <div className="error-banner">{error}</div>}
                <form onSubmit={handleSubmit}>
                    <div className="field">
                        <label htmlFor="accountType">I am a</label>
                        <select id="accountType" value={form.accountType} onChange={update('accountType')}>
                            <option value="staff">Staff member</option>
                            <option value="customer">Customer</option>
                            <option value="vendor">Vendor</option>
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="username">Username</label>
                        <input id="username" value={form.username} onChange={update('username')} required />
                    </div>
                    <div className="field">
                        <label htmlFor="email">Email (optional)</label>
                        <input id="email" type="email" value={form.email} onChange={update('email')} />
                    </div>
                    <div className="field">
                        <label htmlFor="password">Password</label>
                        <input id="password" type="password" minLength={8} value={form.password} onChange={update('password')} required />
                    </div>
                    <div className="field">
                        <label htmlFor="masterBusinessId">{idLabel}</label>
                        <input id="masterBusinessId" value={form.masterBusinessId} onChange={update('masterBusinessId')} />
                        <div className="hint">If you already have one, entering it links your login to your existing record once approved.</div>
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy || !companyId}>
                        {busy ? 'Submitting…' : 'Request access'}
                    </button>
                </form>
                <p style={{ fontSize: 12.5, color: 'var(--ink-600)', marginTop: 18, textAlign: 'center' }}>
                    Already have access? <Link to="/login" style={{ color: 'var(--husk-700)', fontWeight: 600 }}>Sign in</Link>
                </p>
            </div>
        </div>
    );
}
