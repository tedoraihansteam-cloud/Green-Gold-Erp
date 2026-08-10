import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { IconGrain } from '../components/Icons';
import { api } from '../lib/apiClient';
import Modal from '../components/Modal';

export default function LoginPage() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [forgot,setForgot]=useState(false),[identifier,setIdentifier]=useState(''),[forgotMessage,setForgotMessage]=useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
            await login(username, password);
            navigate('/');
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="login-screen">
            <div className="login-card">
                <span className="wordmark on-light"><IconGrain /><span className="green">Green</span> <span className="gold">Gold</span></span>
                <p className="login-tagline">Internal ERP — sign in to continue</p>
                {error && <div className="error-banner">{error}</div>}
                <form onSubmit={handleSubmit}>
                    <div className="field">
                        <label htmlFor="username">Username</label>
                        <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
                    </div>
                    <div className="field">
                        <label htmlFor="password">Password</label>
                        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
                        {busy ? 'Signing in…' : 'Sign in'}
                    </button>
                </form>
                <button type="button" className="btn-ghost" style={{width:'100%',marginTop:10}} onClick={()=>{setForgotMessage('');setForgot(true)}}>Forgot password?</button>
                <p style={{ fontSize: 12.5, color: 'var(--ink-600)', marginTop: 18, textAlign: 'center' }}>
                    New customer, vendor, or staff member? <Link to="/register" style={{ color: 'var(--husk-700)', fontWeight: 600 }}>Request access</Link>
                </p>
            </div>
            {forgot&&<Modal title="Request password reset" onClose={()=>setForgot(false)}><p>An authorized administrator will verify this request and issue a temporary password. Your existing password is never visible.</p><div className="field"><label>Username, email, or phone *</label><input required value={identifier} onChange={e=>setIdentifier(e.target.value)}/></div>{forgotMessage&&<div className="success-banner">{forgotMessage}</div>}<div className="form-actions"><button className="btn btn-secondary" onClick={()=>setForgot(false)}>Cancel</button><button className="btn btn-primary" disabled={!identifier.trim()} onClick={async()=>{try{const r=await api.post('/auth/forgot-password',{identifier});setForgotMessage(r.message);setIdentifier('')}catch(e){setForgotMessage(e.message)}}}>Send request to administrator</button></div></Modal>}
        </div>
    );
}
