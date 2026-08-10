import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, downloadApiFile } from '../../lib/apiClient';
import { useApi } from '../../lib/useApi';
import UniversalBulkImport from './UniversalBulkImport';

const selectablePanels = [
    { key: 'smtp', title: 'Email service', fields: [
        ['mode', 'Email service', [['disabled', 'Disabled'], ['plugin', 'Installed email plug-in'], ['managed', 'Managed company email']]],
        ['documentDelivery', 'Automatic document email', [['true', 'Enabled'], ['false', 'Disabled']]]
    ] },
    { key: 'ai_integration', title: 'AI and document reading', fields: [
        ['mode', 'Document automation', [['review-only', 'Automatic extraction with review'], ['disabled', 'Disabled']]],
        ['confidenceAction', 'Low-confidence fields', [['require-review', 'Always require review'], ['reject', 'Reject the upload']]]
    ] },
    { key: 'theme', title: 'Company theme', fields: [
        ['preset', 'Theme preset', [['green-gold', 'Green Gold'], ['forest', 'Forest'], ['midnight', 'Midnight'], ['light', 'Clean Light']]],
        ['density', 'Screen density', [['comfortable', 'Comfortable'], ['compact', 'Compact']]],
        ['documentStyle', 'Document style', [['classic', 'Classic'], ['modern', 'Modern'], ['minimal', 'Minimal']]]
    ] },
    { key: 'language', title: 'Language', fields: [
        ['defaultLocale', 'Application language', [['en-BD', 'English'], ['bn-BD', 'বাংলা']]],
        ['documentLocale', 'Document language', [['en-BD', 'English'], ['bn-BD', 'বাংলা']]]
    ] },
    { key: 'rental_penalty', title: 'Rental and penalty defaults', fields: [
        ['billingMethod', 'Billing method', [['monthly-closing-stock', 'Monthly closing stock'], ['daily-average', 'Daily average stock'], ['contract-cycle', 'Contract billing cycle']]],
        ['graceDays', 'Grace period', [['0', 'No grace period'], ['3', '3 days'], ['7', '7 days'], ['15', '15 days']]],
        ['penaltyPercent', 'Penalty rate', [['0', 'No penalty'], ['1', '1%'], ['2', '2%'], ['5', '5%']]]
    ] },
    { key: 'barcode_print', title: 'QR and barcode printing', fields: [
        ['labelsPerPage', 'Labels per A4 page', [['10', '10 stickers'], ['12', '12 stickers']]],
        ['codeMode', 'Sticker identity', [['both', 'QR and barcode'], ['qr', 'QR only'], ['barcode', 'Barcode only']]],
        ['showBarcodeText', 'Print readable ID', [['true', 'Yes'], ['false', 'No']]]
    ] },
    { key: 'notifications', title: 'Message alerts', fields: [
        ['primaryChannel', 'Primary alert channel', [['in-app', 'In-app notification'], ['whatsapp', 'WhatsApp'], ['sms', 'SMS'], ['email', 'Email']]],
        ['whatsappEnabled', 'WhatsApp alerts', [['true', 'Enabled'], ['false', 'Disabled']]],
        ['smsEnabled', 'SMS alerts', [['true', 'Enabled'], ['false', 'Disabled']]],
        ['events', 'Alert events', [['approvals-and-dues', 'Approvals and customer dues'], ['approvals', 'Approvals only'], ['all', 'All operational alerts']]]
    ] }
];

function Panel({ panel, values, onChange, onSave, message }) {
    return <section className="card">
        <h2>{panel.title}</h2>
        <p className="hint">Choose the operating option; no technical configuration is required.</p>
        {panel.fields.map(([name, label, choices]) => <div className="field" key={name}>
            <label>{label}</label>
            <select value={values?.[name] ?? choices[0][0]} onChange={(e) => onChange(panel.key, name, e.target.value)}>
                {choices.map(([value, text]) => <option value={value} key={value}>{text}</option>)}
            </select>
        </div>)}
        {message && <div className={message.startsWith('Saved') ? 'success-banner' : 'error-banner'}>{message}</div>}
        <div className="form-actions"><button className="btn btn-primary" onClick={() => onSave(panel.key)}>Save selection</button></div>
    </section>;
}

function ApiConnections() {
    const { data, reload } = useApi('/integrations/connections');
    const blank = { name: '', baseUrl: '', authType: 'none', credential: '', headerName: 'X-API-Key', webhookUrl: '', healthPath: '', timeoutSeconds: 8, enabled: true };
    const [form, setForm] = useState(blank), [message, setMessage] = useState('');
    const set = (name, value) => setForm((v) => ({ ...v, [name]: value }));
    async function save() { try { await api.post('/integrations/connections', form); setForm(blank); setMessage('API connection saved securely'); reload(); } catch (e) { setMessage(e.message); } }
    async function test(id) { try { const result = await api.post(`/integrations/connections/${id}/test`, {}); setMessage(`Connection successful: ${result.message}`); reload(); } catch (e) { setMessage(`Connection failed: ${e.message}`); reload(); } }
    async function remove(id) { if (!window.confirm('Remove this API connection?')) return; try { await api.del(`/integrations/connections/${id}`); setMessage('Connection removed'); reload(); } catch (e) { setMessage(e.message); } }
    function edit(row) { setForm({ id: row.id, name: row.name, baseUrl: row.base_url, authType: row.auth_type, credential: '', headerName: row.header_name || 'X-API-Key', webhookUrl: row.webhook_url || '', healthPath: row.health_path || '', timeoutSeconds: row.timeout_seconds, enabled: row.enabled }); }
    return <section className="card">
        <div className="card-header"><div><h2>API connections</h2><p className="card-subtitle">Enter the API once, save it, and test it from this portal. Credentials are encrypted and never shown again.</p></div></div>
        <div className="form-grid">
            <div className="field"><label>Connection name</label><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Accounting API" /></div>
            <div className="field"><label>Base URL</label><input value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder="https://api.example.com" /></div>
            <div className="field"><label>Authentication</label><select value={form.authType} onChange={(e) => set('authType', e.target.value)}><option value="none">No authentication</option><option value="bearer">Bearer token</option><option value="api-key">API key header</option><option value="basic">Basic credentials</option></select></div>
            {form.authType !== 'none' && <div className="field"><label>{form.id ? 'New credential (leave blank to keep existing)' : 'Credential / token'}</label><input type="password" value={form.credential} onChange={(e) => set('credential', e.target.value)} autoComplete="new-password" /></div>}
            {form.authType === 'api-key' && <div className="field"><label>API key header name</label><input value={form.headerName} onChange={(e) => set('headerName', e.target.value)} /></div>}
            <div className="field"><label>Health/test path</label><input value={form.healthPath} onChange={(e) => set('healthPath', e.target.value)} placeholder="health or v1/status" /></div>
            <div className="field"><label>Webhook URL (optional)</label><input value={form.webhookUrl} onChange={(e) => set('webhookUrl', e.target.value)} placeholder="https://..." /></div>
            <div className="field"><label>Timeout</label><select value={form.timeoutSeconds} onChange={(e) => set('timeoutSeconds', Number(e.target.value))}><option value={5}>5 seconds</option><option value={8}>8 seconds</option><option value={15}>15 seconds</option><option value={30}>30 seconds</option></select></div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Connection enabled</label>
        </div>
        {message && <div className={/saved|successful|removed/.test(message) ? 'success-banner' : 'error-banner'}>{message}</div>}
        <div className="form-actions"><button className="btn btn-secondary" onClick={() => setForm(blank)}>Clear</button><button className="btn btn-primary" onClick={save}>{form.id ? 'Update connection' : 'Save connection'}</button></div>
        <div style={{ marginTop: 18 }}><h3>SAVED CONNECTIONS</h3><table className="data"><thead><tr><th>Name</th><th>Base URL</th><th>Auth</th><th>Last test</th><th>Actions</th></tr></thead><tbody>{(data?.connections || []).map((row) => <tr key={row.id}><td><strong>{row.name}</strong>{!row.enabled && <span className="pill">disabled</span>}</td><td className="mono">{row.base_url}</td><td>{row.auth_type}{row.credentialConfigured ? ' · credential saved' : ''}</td><td><span className={`pill${row.last_test_status === 'success' ? ' pill-success' : row.last_test_status ? ' pill-danger' : ''}`}>{row.last_test_status || 'not tested'}</span><div className="hint">{row.last_test_message}</div></td><td><div style={{ display: 'flex', gap: 6 }}><button className="btn btn-secondary btn-sm" onClick={() => edit(row)}>Edit</button><button className="btn btn-secondary btn-sm" onClick={() => test(row.id)}>Test</button><button className="btn btn-secondary btn-sm" onClick={() => remove(row.id)}>Remove</button></div></td></tr>)}{!(data?.connections || []).length && <tr><td colSpan="5">No API connection configured.</td></tr>}</tbody></table></div>
    </section>;
}

const permissionOptions = ['ACCOUNTS_APPROVE','HR_APPROVE','INVENTORY_APPROVE','COLD_STORAGE_APPROVE','USER_MANAGEMENT_APPROVE','LOGISTICS_APPROVE','MANUFACTURING_APPROVE','SECURITY_APPROVE'];
function WorkflowCard({ workflow, reload, users=[] }) {
    const [form, setForm] = useState(workflow), [message, setMessage] = useState('');
    useEffect(() => setForm(workflow), [workflow]);
    const set = (name, value) => setForm((v) => ({ ...v, [name]: value }));
    const steps = form.approval_steps || [];
    const updateStep = (index, name, value) => set('approval_steps', steps.map((s, i) => i === index ? { ...s, [name]: value } : s));
    async function save() { try { await api.put(`/integrations/workflows/${form.workflow_key}`, { workflowKey: form.workflow_key, displayName: form.display_name, enabled: form.enabled, requireAttachment: form.require_attachment, autoApproveBelow: form.auto_approve_below, escalationHours: form.escalation_hours, notifyRequester: form.notify_requester, notifyChannels: form.notify_channels, approvalSteps: steps }); setMessage('Workflow controls saved'); reload(); } catch (e) { setMessage(e.message); } }
    return <section className="card"><div className="card-header"><div><h2>{form.display_name}</h2><p className="card-subtitle mono">{form.workflow_key}</p></div><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Enabled</label></div>
        <div className="form-grid"><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={form.require_attachment} onChange={(e) => set('require_attachment', e.target.checked)} /> Supporting document required</label><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={form.notify_requester} onChange={(e) => set('notify_requester', e.target.checked)} /> Notify requester after action</label><div className="field"><label>Auto-approve below amount (blank disables)</label><input type="number" min="0" value={form.auto_approve_below ?? ''} onChange={(e) => set('auto_approve_below', e.target.value)} /></div><div className="field"><label>Escalate after hours</label><input type="number" min="1" max="720" value={form.escalation_hours ?? ''} onChange={(e) => set('escalation_hours', e.target.value)} /></div></div>
        <div className="field"><label>Notification channels</label><div style={{ display: 'flex', gap: 14 }}>{['in-app','email','whatsapp','sms'].map((channel) => <label key={channel}><input type="checkbox" checked={(form.notify_channels || []).includes(channel)} onChange={(e) => set('notify_channels', e.target.checked ? [...(form.notify_channels || []), channel] : (form.notify_channels || []).filter((x) => x !== channel))} /> {channel}</label>)}</div></div>
        <h3>APPROVAL STEPS & INDIVIDUAL DUTIES</h3>{steps.map((step, index) => <div className="card" style={{ padding: 12, marginBottom: 10 }} key={index}><div className="form-grid"><div className="field"><label>Step name</label><input value={step.name || ''} onChange={(e) => updateStep(index, 'name', e.target.value)} /></div><div className="field"><label>Department</label><select value={step.department || 'accounts'} onChange={(e) => updateStep(index, 'department', e.target.value)}>{['accounts','hr','inventory','cold-storage','management','logistics','manufacturing','security','procurement','operations'].map((x) => <option key={x}>{x}</option>)}</select></div><div className="field"><label>Required permission</label><select value={step.permission || 'ACCOUNTS_APPROVE'} onChange={(e) => updateStep(index, 'permission', e.target.value)}>{permissionOptions.map((x) => <option key={x}>{x}</option>)}</select></div><div className="field"><label>Assigned individual</label><select value={step.assigneeUserId || ''} onChange={(e) => updateStep(index, 'assigneeUserId', e.target.value)}><option value="">Any authorized person in department</option>{users.filter(u=>u.status==='active').map(u=><option key={u.id} value={u.id}>{u.linked_record_name || u.username} ({u.username})</option>)}</select></div><label><input type="checkbox" checked={step.required !== false} onChange={(e) => updateStep(index, 'required', e.target.checked)} /> Required step</label><label><input type="checkbox" checked={step.allowReject !== false} onChange={(e) => updateStep(index, 'allowReject', e.target.checked)} /> Can reject</label></div><button className="btn btn-secondary btn-sm" onClick={() => set('approval_steps', steps.filter((_, i) => i !== index))}>Remove step</button></div>)}
        <button className="btn btn-secondary" onClick={() => set('approval_steps', [...steps, { name: `Approval step ${steps.length + 1}`, department: 'accounts', permission: 'ACCOUNTS_APPROVE', required: true, allowReject: true }])}>Add approval step</button>
        {message && <div className={message.startsWith('Workflow') ? 'success-banner' : 'error-banner'}>{message}</div>}<div className="form-actions"><button className="btn btn-primary" onClick={save}>Save workflow</button></div>
    </section>;
}
function WorkflowSettings() { const { data, reload } = useApi('/integrations/workflows'),{data:userData}=useApi('/users?status=active'); return <div><div className="card-header" style={{ margin: '22px 0 12px' }}><div><h2>Workflow & individual duties</h2><p className="card-subtitle">Management assigns each approval duty to a department, permission, and optionally one responsible individual.</p></div></div>{(data?.workflows || []).map((workflow) => <WorkflowCard key={workflow.workflow_key} workflow={workflow} reload={reload} users={userData?.users||[]} />)}</div>; }

function CompanyProfile({ company, reload, section = 'all' }) {
    const [form, setForm] = useState({}), [site, setSite] = useState({ siteType: 'office' }), [message, setMessage] = useState('');
    useEffect(() => { if (company?.profile) setForm({ companyName: company.profile.name || '', tagline: company.profile.tagline || '', slogan: company.profile.slogan || '', phone: company.profile.phone || '', email: company.profile.email || '', website: company.profile.website || '', registrationNumber: company.profile.registration_number || '', taxNumber: company.profile.tax_number || '', currency: company.profile.currency || 'BDT' }); }, [company]);
    const set = (name, value) => setForm((v) => ({ ...v, [name]: value }));
    async function save() { try { await api.put('/company-settings', form); setMessage('Saved company identity'); reload(); } catch (e) { setMessage(e.message); } }
    async function upload(kind, file) { if (!file) return; const data = new FormData(); data.append('file', file); try { await api.postForm(`/company-settings/assets/${kind}`, data); setMessage(`Saved ${kind}`); reload(); } catch (e) { setMessage(e.message); } }
    async function addSite() { try { await api.post('/company-settings/sites', site); setSite({ siteType: 'office' }); setMessage('Saved company location'); reload(); } catch (e) { setMessage(e.message); } }
    return <>
        {(section === 'all' || section === 'company') && <section className="card">
            <h2>Company identity and document branding</h2>
            <p className="hint">This identity appears automatically on invoices, bills, receipts, vouchers, reports, and other generated documents.</p>
            <div className="form-grid">
                {[['companyName', 'Company name'], ['tagline', 'Tagline'], ['slogan', 'Slogan'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'], ['registrationNumber', 'Registration number'], ['taxNumber', 'Tax number']].map(([name, label]) => <div className="field" key={name}><label>{label}</label><input value={form[name] || ''} onChange={(e) => set(name, e.target.value)} /></div>)}
                <div className="field"><label>Currency</label><select value={form.currency || 'BDT'} onChange={(e) => set('currency', e.target.value)}><option value="BDT">Bangladeshi Taka (BDT)</option></select></div>
                <div className="field"><label>Company logo</label><input type="file" accept="image/*" onChange={(e) => upload('logo', e.target.files?.[0])} /></div>
                <div className="field"><label>Company seal</label><input type="file" accept="image/*" onChange={(e) => upload('seal', e.target.files?.[0])} /></div>
            </div>
            {message && <div className={message.startsWith('Saved') ? 'success-banner' : 'error-banner'}>{message}</div>}
            <div className="form-actions"><button className="btn btn-primary" onClick={save}>Save company profile</button></div>
        </section>}
        {(section === 'all' || section === 'locations') && <section className="card">
            <h2>Office and factory locations</h2>
            <div className="form-grid">
                <div className="field"><label>Location type</label><select value={site.siteType || 'office'} onChange={(e) => setSite((v) => ({ ...v, siteType: e.target.value }))}><option value="office">Office</option><option value="factory">Factory</option><option value="warehouse">Warehouse</option><option value="cold-store">Cold store</option></select></div>
                {[['name', 'Location name'], ['address', 'Full address'], ['contactName', 'Contact person'], ['contactPhone', 'Contact phone']].map(([name, label]) => <div className="field" key={name}><label>{label}</label><input value={site[name] || ''} onChange={(e) => setSite((v) => ({ ...v, [name]: e.target.value }))} /></div>)}
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={!!site.isDocumentAddress} onChange={(e) => setSite((v) => ({ ...v, isDocumentAddress: e.target.checked }))} /> Use this address on generated documents</label>
            </div>
            <div className="form-actions"><button className="btn btn-primary" onClick={addSite}>Add location</button></div>
            {(company?.sites || []).map((x) => <div key={x.id} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}><strong>{x.name}</strong> · {x.site_type}{x.is_document_address ? ' · Document address' : ''}<div className="hint">{x.address || 'No address recorded'}</div></div>)}
        </section>}
    </>;
}

function BulkImport() {
    const { data, reload } = useApi('/bulk-imports');
    const [type, setType] = useState('customer'), [file, setFile] = useState(null), [active, setActive] = useState(null), [mapping, setMapping] = useState({}), [message, setMessage] = useState('');
    async function upload() { if (!file) return setMessage('Select a file first'); const form = new FormData(); form.append('importType', type); form.append('file', file); try { const result = await api.postForm('/bulk-imports', form); setActive(result.job); setMapping(result.job.field_mapping || {}); setMessage('File detected. Review the columns and sample below.'); reload(); } catch (e) { setMessage(e.message); } }
    async function submit() { try { await api.put(`/bulk-imports/${active.business_id}/mapping`, { fieldMapping: mapping }); const result = await api.post(`/bulk-imports/${active.business_id}/submit`, {}); setMessage(`${result.imported} records imported successfully with QR and barcode identities`); setActive(null); reload(); } catch (e) { setMessage(e.message); try { const refreshed = await api.get(`/bulk-imports/${active.business_id}`); setActive(refreshed.job); } catch { /* preserve current review */ } } }
    async function openJob(businessId) { try { const result = await api.get(`/bulk-imports/${businessId}`); setActive(result.job); setMapping(result.job.field_mapping || {}); setMessage('Review job loaded'); } catch (e) { setMessage(e.message); } }
    async function removeActive() { if (!active || !window.confirm(`Remove review upload ${active.business_id}?`)) return; try { await api.del(`/bulk-imports/${active.business_id}`); setActive(null); setMessage('Review upload removed'); reload(); } catch (e) { setMessage(e.message); } }
    const rows = active?.preview_rows || [], columns = active?.detected_columns || [];
    return <section className="card">
        <h2>Bulk upload and automation</h2><p className="hint">Upload → automatic column detection → validation → review → final submission. Submitted records receive permanent QR and barcode identities.</p>
        <div className="form-grid"><div className="field"><label>Record type</label><select value={type} onChange={(e) => setType(e.target.value)}><option value="customer">Customers</option><option value="product">Products</option><option value="vendor">Vendors</option></select></div><div className="field"><label>Data file</label><input type="file" accept=".csv,.json,.xlsx,.xlsm" onChange={(e) => setFile(e.target.files?.[0])} /></div></div>
        <div className="form-actions"><button className="btn btn-secondary" onClick={() => downloadApiFile(`/bulk-imports/template/${type}`, `${type}-bulk-upload-template.csv`)}>Download template</button><button className="btn btn-primary" onClick={upload}>Upload and review</button></div>
        {message && <div className={/successfully|detected/.test(message) ? 'success-banner' : 'error-banner'}>{message}</div>}
        {active && <div style={{ marginTop: 18 }}><h3>Review {active.original_name} ({rows.length} rows)</h3>{(active.validation_errors || []).length > 0 && <div className="error-banner"><strong>Validation requires attention</strong>{active.validation_errors.slice(0, 10).map((x, i) => <div key={i}>{x.row ? `Row ${x.row}: ` : ''}{x.field} - {x.message}</div>)}</div>}<div className="form-grid">{Object.keys(mapping).map((target) => <div className="field" key={target}><label>{target}{target === 'name' ? ' *' : ''}</label><select value={mapping[target] || ''} onChange={(e) => setMapping((v) => ({ ...v, [target]: e.target.value }))}><option value="">Do not import</option>{columns.map((c) => <option value={c} key={c}>{c}</option>)}</select></div>)}</div><div style={{ overflowX: 'auto' }}><table className="data"><thead><tr><th>Row</th>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{rows.slice(0, 10).map((row, i) => <tr key={i}><td>{i + 2}</td>{columns.map((c) => <td key={c}>{row[c]}</td>)}</tr>)}</tbody></table></div><p className="hint">Showing 10 of {rows.length} rows. Final submission imports the complete validated file.</p><div className="form-actions"><button className="btn btn-secondary" onClick={removeActive}>Remove review upload</button><button className="btn btn-primary" onClick={submit}>Validate and submit all rows</button></div></div>}
        <div style={{ marginTop: 16 }}><h3>RECENT UPLOADS</h3>{(data?.jobs || []).slice(0, 6).map((j) => <button key={j.business_id} className="btn btn-secondary btn-sm" style={{ margin: '0 6px 6px 0' }} onClick={() => openJob(j.business_id)}>{j.business_id} · {j.import_type} · {j.row_count} rows · {j.status}</button>)}</div>
    </section>;
}

export default function AppSettingsPage() {
    const { section } = useParams();
    const navigate = useNavigate();
    const { data: settingsData } = useApi('/settings');
    const { data: company, reload: reloadCompany } = useApi('/company-settings');
    const initial = useMemo(() => Object.fromEntries((settingsData?.settings || []).filter((x) => !x.is_secret).map((x) => [x.setting_key, x.setting_value])), [settingsData]);
    const [values, setValues] = useState({}), [messages, setMessages] = useState({});
    useEffect(() => setValues(initial), [initial]);
    const set = (key, name, value) => setValues((v) => ({ ...v, [key]: { ...(v[key] || {}), [name]: value } }));
    async function save(key) { try { await api.put(`/settings/${key}`, values[key] || {}); setMessages((m) => ({ ...m, [key]: 'Saved successfully' })); } catch (e) { setMessages((m) => ({ ...m, [key]: e.message })); } }
    const sections = [
        ['company', 'Company identity & document branding'], ['locations', 'Office & factory locations'],
        ['api', 'API connections'], ['workflow', 'Workflow & individual duties'],
        ['upload', 'Universal data upload & automation'], ['smtp', 'Email service'],
        ['ai_integration', 'AI & document reading'], ['theme', 'Company theme'],
        ['language', 'Language'], ['rental_penalty', 'Rental & penalty defaults'],
        ['barcode_print', 'QR & barcode printing'], ['notifications', 'Message alerts'],
        ['devices', 'Integration & Device Hub']
    ];
    if (!section) return <div><div className="card-header" style={{ marginBottom: 18 }}><div><h1 className="page-title">Application settings</h1><p className="card-subtitle">Select an individual company-wide setting to view or manage it.</p></div></div><div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>{sections.map(([key, title]) => <button type="button" key={key} className="card" style={{ textAlign: 'left', cursor: 'pointer', minHeight: 105 }} onClick={() => navigate(key === 'devices' ? '/admin/integration-hub' : `/admin/settings/${key}`)}><h2 style={{ marginBottom: 6 }}>{title}</h2><span className="hint">Open settings</span></button>)}</div></div>;
    const selectedPanel = selectablePanels.find((p) => p.key === section);
    const title = sections.find(([key]) => key === section)?.[1] || 'Application settings';
    return <div><div className="card-header" style={{ marginBottom: 18 }}><div><h1 className="page-title">{title}</h1><p className="card-subtitle">Permission-controlled application configuration</p></div><button className="btn btn-secondary" onClick={() => navigate('/admin/settings')}>All settings</button></div>
        {(section === 'company' || section === 'locations') && <CompanyProfile company={company} reload={reloadCompany} section={section} />}
        {section === 'api' && <ApiConnections />}
        {section === 'workflow' && <WorkflowSettings />}
        {section === 'upload' && <UniversalBulkImport />}
        {selectedPanel && <Panel panel={selectedPanel} values={values[selectedPanel.key]} onChange={set} onSave={save} message={messages[selectedPanel.key]} />}
        {!sections.some(([key]) => key === section) && <div className="error-banner">This settings section does not exist.</div>}
    </div>;
}
