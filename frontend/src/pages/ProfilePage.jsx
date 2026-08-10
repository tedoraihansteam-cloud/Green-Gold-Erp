import { useEffect, useState } from 'react';
import { useApi } from '../lib/useApi';
import { api } from '../lib/apiClient';
import { useLocation } from 'react-router-dom';

const defaults = { theme: 'system', accent: 'green', density: 'comfortable', sidebarMode: 'expanded', locale: 'en-BD', dateFormat: 'DD/MM/YYYY', timeFormat: '12-hour', defaultPrintSize: 'A4', reducedMotion: false, largerText: false, highContrast: false, defaultDashboard: 'overview', dashboardWidgets: [], operationalScopeId:'', operationalScopeName:'', operationalScopeType:'' };
const accents = ['green','emerald','blue','indigo','purple','rose','orange','gold','teal','slate'];
const readCachedPreferences = () => { try { return JSON.parse(localStorage.getItem('ggerp:appearance') || '{}'); } catch { return {}; } };

function applyPreview(prefs) {
    const root = document.documentElement;
    root.dataset.theme = prefs.theme;
    root.dataset.accent = prefs.accent;
    root.dataset.density = prefs.density;
    root.dataset.sidebar = prefs.sidebarMode;
    root.dataset.reducedMotion = String(prefs.reducedMotion);
    root.dataset.largerText = String(prefs.largerText);
    root.dataset.highContrast = String(prefs.highContrast);
    root.lang = prefs.locale === 'bn-BD' ? 'bn' : 'en';
    localStorage.setItem('ggerp:appearance', JSON.stringify({ theme:prefs.theme, accent:prefs.accent, density:prefs.density, sidebarMode:prefs.sidebarMode, locale:prefs.locale, dateFormat:prefs.dateFormat, timeFormat:prefs.timeFormat, operationalScopeId:prefs.operationalScopeId, operationalScopeName:prefs.operationalScopeName, operationalScopeType:prefs.operationalScopeType, reducedMotion:!!prefs.reducedMotion, largerText:!!prefs.largerText, highContrast:!!prefs.highContrast }));
    window.dispatchEvent(new CustomEvent('ggerp:preferences-preview', { detail: prefs }));
}

export default function ProfilePage() {
    const location = useLocation();
    const { data, loading, error, reload } = useApi('/users/me');
    const { data: companyData } = useApi('/company-settings');
    const [form, setForm] = useState({ displayName: '', email: '', phone: '', profilePhotoUrl: '', preferences: defaults });
    const [message, setMessage] = useState(''), [formError, setFormError] = useState('');
    const bn = form.preferences.locale === 'bn-BD';
    useEffect(() => {
        if (location.hash !== '#operational-scope' || loading) return;
        requestAnimationFrame(() => document.getElementById('operational-scope')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }, [location.hash, loading]);
    useEffect(() => {
        document.querySelectorAll('form .field').forEach((field, index) => {
            const control = field.querySelector('input,select,textarea');
            const label = field.querySelector('label');
            if (!control || !label) return;
            const id = control.id || `profile-field-${index}`;
            control.id = id;
            label.htmlFor = id;
        });
        const timeSelect=[...document.querySelectorAll('form select')].find((select)=>select.labels?.[0]?.textContent?.includes(bn?'সময়':'Time'));
        if(timeSelect){timeSelect.options[0].text=bn?'১২ ঘণ্টা':'12 hour';timeSelect.options[1].text=bn?'২৪ ঘণ্টা':'24 hour';}
    },[bn,data]);
    const t = (english, bangla) => bn ? bangla : english;
    useEffect(() => {
        if (!data?.profile) return;
        const p = data.profile, preferences = { ...defaults, ...readCachedPreferences(), ...(p.preferences || {}) };
        setForm({ displayName: p.display_name || '', email: p.email || '', phone: p.phone || '', profilePhotoUrl: p.profile_photo_url || '', preferences });
        applyPreview(preferences);
    }, [data]);
    const setPreference = (key, value) => setForm((current) => {
        const preferences = { ...current.preferences, [key]: value };
        applyPreview(preferences);
        return { ...current, preferences };
    });
    const setOperationalScope = (siteId) => {
        const site = (companyData?.sites || []).find((entry) => entry.id === siteId);
        if (!site) return;
        setForm((current) => {
            const preferences = { ...current.preferences, operationalScopeId: site.id, operationalScopeName: site.name, operationalScopeType: site.site_type };
            applyPreview(preferences);
            return { ...current, preferences };
        });
    };
    const resetAppearance = () => setForm((current) => { applyPreview(defaults); return { ...current, preferences: { ...current.preferences, ...defaults } }; });
    const save = async (event) => {
        event.preventDefault();
        try { setFormError(''); setMessage(''); await api.put('/users/me', form); setMessage('Profile and personal preferences saved across devices.'); reload(); }
        catch (err) { setFormError(err.message); }
    };
    if (loading) return <div className="skeleton-page" aria-label="Loading profile"><div className="skeleton wide"/><div className="skeleton-card"/></div>;
    return <div>
        <div className="page-header"><div><div className="breadcrumbs">{t('Settings / My preferences','সেটিংস / আমার পছন্দ')}</div><h1 className="page-title">{t('My profile & appearance','আমার প্রোফাইল ও প্রদর্শন')}</h1><p className="card-subtitle">{t("Your interface choices follow your account and never alter company documents or another user's workspace.",'আপনার ইন্টারফেস পছন্দ শুধু আপনার অ্যাকাউন্টে প্রযোজ্য; কোম্পানির নথি বা অন্য ব্যবহারকারীর কর্মক্ষেত্র পরিবর্তন করে না।')}</p></div></div>
        <form onSubmit={save}>{error && <div className="error-banner">{error}</div>}{formError && <div className="error-banner">{formError}</div>}{message && <div className="success-banner">{message}</div>}
            <section className="card"><div className="card-header"><div><h2>{t('Personal information','ব্যক্তিগত তথ্য')}</h2><p className="card-subtitle">{t('Account contact and display information','অ্যাকাউন্টের যোগাযোগ ও প্রদর্শন তথ্য')}</p></div></div><div className="form-grid"><div className="field"><label>{t('Display name','প্রদর্শিত নাম')}</label><input value={form.displayName} onChange={(e) => setForm((s) => ({ ...s, displayName: e.target.value }))} /></div><div className="field"><label>{t('Username','ব্যবহারকারীর নাম')}</label><input disabled value={data?.profile?.username || ''} /></div><div className="field"><label>{t('Email','ইমেইল')}</label><input type="email" value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} /></div><div className="field"><label>{t('Phone','ফোন')}</label><input value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} /></div></div><div className="field"><label>{t('Profile photo URL','প্রোফাইল ছবির URL')}</label><input value={form.profilePhotoUrl} onChange={(e) => setForm((s) => ({ ...s, profilePhotoUrl: e.target.value }))} /></div></section>
            <section className="card"><div className="card-header"><div><h2>{t('Appearance','প্রদর্শন')}</h2><p className="card-subtitle">{t('Preview changes immediately, then save them to your ERP profile.','পরিবর্তন সঙ্গে সঙ্গে দেখুন, তারপর ERP প্রোফাইলে সংরক্ষণ করুন।')}</p></div><button type="button" className="btn btn-secondary" onClick={resetAppearance}>{t('Reset Green Gold default','গ্রিন গোল্ড ডিফল্ট পুনঃস্থাপন')}</button></div>
                <div className="preference-group"><label>{t('Appearance mode','প্রদর্শন মোড')}</label><div className="segmented">{[['light','Light','লাইট'],['system','System','সিস্টেম'],['dark','Dark','ডার্ক']].map(([x,en,bnText])=><button type="button" key={x} className={form.preferences.theme===x?'selected':''} onClick={()=>setPreference('theme',x)}>{t(en,bnText)}</button>)}</div></div>
                <div className="preference-group"><label>{t('Interface accent','ইন্টারফেস রং')}</label><div className="color-swatches">{accents.map((x)=><button type="button" key={x} className={`swatch swatch-${x}${form.preferences.accent===x?' selected':''}`} aria-label={`${x} interface color`} title={x} onClick={()=>setPreference('accent',x)} />)}</div></div>
                <div className="form-grid"><div className="field"><label>{t('Interface density','ইন্টারফেস ঘনত্ব')}</label><select value={form.preferences.density} onChange={(e)=>setPreference('density',e.target.value)}><option value="comfortable">{t('Comfortable','আরামদায়ক')}</option><option value="compact">{t('Compact','কম্প্যাক্ট')}</option><option value="dense">{t('Dense','ঘন')}</option></select></div><div className="field"><label>{t('Sidebar style','সাইডবার ধরন')}</label><select value={form.preferences.sidebarMode} onChange={(e)=>setPreference('sidebarMode',e.target.value)}><option value="expanded">{t('Expanded','সম্প্রসারিত')}</option><option value="collapsed">{t('Collapsed','সংকুচিত')}</option><option value="auto">{t('Auto-collapse','স্বয়ংক্রিয় সংকোচন')}</option><option value="icon-only">{t('Icon only','শুধু আইকন')}</option></select></div></div>
                <div className="preference-toggles">{[['reducedMotion','Reduced animation'],['largerText','Larger text'],['highContrast','High contrast']].map(([key,label])=><label key={key}><input type="checkbox" checked={!!form.preferences[key]} onChange={(e)=>setPreference(key,e.target.checked)}/>{label}</label>)}</div>
                <div className="theme-preview"><div className="preview-sidebar">GG</div><div className="preview-body"><strong>Live interface preview</strong><p>Cards, controls and navigation use your personal accent.</p><button type="button" className="btn btn-primary">Primary action</button></div></div>
            </section>
            <section className="card"><div className="card-header"><h2>{t('Regional & workspace defaults','আঞ্চলিক ও কর্মক্ষেত্র ডিফল্ট')}</h2></div><div className="form-grid"><div className="field"><label>{t('Language','ভাষা')}</label><select value={form.preferences.locale} onChange={(e)=>setPreference('locale',e.target.value)}><option value="en-BD">English</option><option value="bn-BD">বাংলা</option></select></div><div className="field"><label>{t('Date format','তারিখের ধরন')}</label><select value={form.preferences.dateFormat} onChange={(e)=>setPreference('dateFormat',e.target.value)}><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option></select></div><div className="field"><label>{t('Time format','সময়ের ধরন')}</label><select value={form.preferences.timeFormat} onChange={(e)=>setPreference('timeFormat',e.target.value)}><option value="12-hour">১২ ঘণ্টা</option><option value="24-hour">২৪ ঘণ্টা</option></select></div><div className="field"><label>{t('Default print size','ডিফল্ট প্রিন্ট সাইজ')}</label><select value={form.preferences.defaultPrintSize} onChange={(e)=>setPreference('defaultPrintSize',e.target.value)}><option value="A4">A4 {t('document','নথি')}</option><option value="label">{t('Identity label','পরিচয় লেবেল')}</option></select></div></div></section>
            <div className="sticky-form-actions"><button className="btn btn-primary" type="submit">{t('Save my preferences','আমার পছন্দ সংরক্ষণ করুন')}</button></div>
            <section className="card" id="operational-scope">
                <div className="card-header"><div><h2>{t('Operational scope','কাজের স্থান')}</h2><p className="card-subtitle">{t('Choose the office, factory, store or branch used as your current working location. Locations are managed in Application settings.','আপনার বর্তমান কাজের স্থান হিসেবে অফিস, কারখানা, স্টোর বা শাখা নির্বাচন করুন। লোকেশন অ্যাপ্লিকেশন সেটিংসে পরিচালিত হয়।')}</p></div></div>
                <div className="form-grid"><div className="field"><label htmlFor="operationalScope">{t('Current office / factory / location','বর্তমান অফিস / কারখানা / লোকেশন')}</label><select id="operationalScope" value={form.preferences.operationalScopeId || ''} onChange={(e)=>setOperationalScope(e.target.value)}><option value="" disabled>{t('Select a configured location','কনফিগার করা লোকেশন নির্বাচন করুন')}</option>{(companyData?.sites || []).map((site)=><option key={site.id} value={site.id}>{site.name} — {String(site.site_type || 'location').replaceAll('_',' ')}</option>)}</select></div><div className="field"><label>{t('Selected location address','নির্বাচিত লোকেশনের ঠিকানা')}</label><div className="read-only-value">{(companyData?.sites || []).find((site)=>site.id===form.preferences.operationalScopeId)?.address || t('No location selected','কোনো লোকেশন নির্বাচন করা হয়নি')}</div></div></div>
                {!(companyData?.sites || []).length && <p className="alert alert-warning">{t('No locations are configured. Add one under Settings → Office & factory locations.','কোনো লোকেশন কনফিগার করা নেই। সেটিংস → অফিস ও কারখানার লোকেশনে যোগ করুন।')}</p>}
            </section>
        </form>
    </div>;
}
