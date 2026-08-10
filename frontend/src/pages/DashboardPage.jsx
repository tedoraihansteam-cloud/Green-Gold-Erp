import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/useApi';
import { api } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';

const widgetCatalog = [
    ['customers','Customers'],['vendors','Vendors'],['employees','Employees'],['approvals','Pending approvals'],
    ['notices','Unread notices'],['distribution','Master data distribution'],['activity','Today at a glance'],['quick','Quick actions']
];

function KpiCard({ title, value, meta, alert }) {
    return <section className={`card widget kpi-card${alert ? ' alert' : ''}`}><div className="kpi-label">{title}</div><div className="kpi-value">{value}</div><div className="kpi-meta">{meta}</div></section>;
}
function LoadingDashboard() { return <div className="dashboard-grid">{[1,2,3,4,5,6].map((x)=><div className="card widget" key={x}><div className="skeleton wide"/><div className="skeleton-card"/></div>)}</div>; }

export default function DashboardPage() {
    const { data, loading, error } = useApi('/dashboard/summary');
    const { data: profileData, reload: reloadProfile } = useApi('/users/me');
    const { user, can } = useAuth();
    const [customizing, setCustomizing] = useState(false), [saving, setSaving] = useState(false), [selected, setSelected] = useState(widgetCatalog.map(([key])=>key));
    useEffect(()=>{const saved=profileData?.profile?.preferences?.dashboardWidgets;if(Array.isArray(saved)&&saved.length)setSelected(saved)},[profileData]);
    const show=(key)=>selected.includes(key);
    const total = useMemo(()=>data ? Math.max(1,data.customers+data.vendors+data.employees) : 1,[data]);
    async function saveLayout() {
        const p=profileData?.profile;if(!p)return;
        setSaving(true);
        try { await api.put('/users/me',{displayName:p.display_name,email:p.email,phone:p.phone,profilePhotoUrl:p.profile_photo_url,preferences:{...(p.preferences||{}),dashboardWidgets:selected}}); await reloadProfile(); setCustomizing(false); }
        finally { setSaving(false); }
    }
    const firstName=(profileData?.profile?.display_name||user?.username||'User').split(' ')[0];
    return <div>
        <div className="page-header"><div><div className="breadcrumbs">Overview / Dashboard</div><h1 className="page-title">Good morning, {firstName}</h1><p className="card-subtitle">You have {data?.pendingApprovals || 0} approvals and {data?.unreadNotices || 0} unread notices requiring attention.</p></div><div className="dashboard-toolbar"><Link to="/reports" className="btn btn-secondary">Export & reports</Link><button className="btn btn-secondary" onClick={()=>setCustomizing((x)=>!x)}>Customize dashboard</button><button className="btn btn-primary" onClick={()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))}>+ Quick action</button></div></div>
        {error && <div className="error-banner" role="alert">Dashboard could not load: {error}</div>}
        {customizing && <section className="card"><div className="card-header"><div><h2>Choose dashboard widgets</h2><p className="card-subtitle">Only widgets permitted for your account are available.</p></div></div><div className="preference-toggles">{widgetCatalog.map(([key,label])=><label key={key}><input type="checkbox" checked={show(key)} onChange={(e)=>setSelected((items)=>e.target.checked?[...items,key]:items.filter((x)=>x!==key))}/>{label}</label>)}</div><div className="form-actions"><button className="btn btn-secondary" onClick={()=>setSelected(widgetCatalog.map(([key])=>key))}>Reset layout</button><button className="btn btn-primary" disabled={saving} onClick={saveLayout}>{saving?'Saving…':'Save dashboard'}</button></div></section>}
        {loading && <LoadingDashboard />}
        {!loading && data && <div className="dashboard-grid">
            {show('customers')&&can('SALES_VIEW')&&<KpiCard title="Customers" value={data.customers.toLocaleString()} meta="Active master customer records"/>}
            {show('vendors')&&can('INVENTORY_VIEW')&&<KpiCard title="Vendors" value={data.vendors.toLocaleString()} meta="Available procurement vendors"/>}
            {show('employees')&&can('HR_VIEW')&&<KpiCard title="Workforce" value={data.employees.toLocaleString()} meta="Employee master records"/>}
            {show('approvals')&&can('USER_MANAGEMENT_VIEW')&&<KpiCard title="Pending approvals" value={data.pendingApprovals.toLocaleString()} meta="Items awaiting authorized review" alert={data.pendingApprovals>0}/>} 
            {show('notices')&&<KpiCard title="Unread notices" value={data.unreadNotices.toLocaleString()} meta="Company notices not yet opened" alert={data.unreadNotices>0}/>} 
            {data.workforce&&<KpiCard title="My attendance" value={data.workforce.clockedIn?'Clocked in':'Not clocked in'} meta={`${data.workforce.openTasks} open tasks · ${data.workforce.presentDays} present days this month`}/>} 
            {show('distribution')&&<section className="card widget wide"><div className="card-header"><div><h2>Master data distribution</h2><p className="card-subtitle">Current permitted operational records</p></div></div><div style={{display:'grid',gridTemplateColumns:'180px 1fr',gap:24,alignItems:'center'}}><div className="donut" aria-label="Distribution donut chart"/><div>{[['Customers',data.customers,'var(--chart-1)'],['Vendors',data.vendors,'var(--chart-2)'],['Employees',data.employees,'var(--chart-3)']].map(([label,value,color])=><div key={label} style={{marginBottom:12}}><div style={{display:'flex',justifyContent:'space-between'}}><span><i className="legend-dot" style={{background:color}}/>{label}</span><strong>{value}</strong></div><div className="kpi-meta">{Math.round(value/total*100)}% of displayed master records</div></div>)}</div></div></section>}
            {show('activity')&&<section className="card widget"><div className="card-header"><h2>Today at a glance</h2></div><ul className="activity-list"><li><i className="activity-marker"/><div><strong>{data.pendingApprovals} approvals pending</strong><div className="kpi-meta">Open the approval center for review</div></div></li><li><i className="activity-marker"/><div><strong>{data.unreadNotices} unread notices</strong><div className="kpi-meta">Company communication center</div></div></li>{data.workforce&&<li><i className="activity-marker"/><div><strong>{data.workforce.openTasks} open tasks</strong><div className="kpi-meta">Personal attendance and duty workspace</div></div></li>}</ul></section>}
            {show('quick')&&<section className="card widget full"><div className="card-header"><div><h2>Quick actions</h2><p className="card-subtitle">Actions are shown according to your permissions.</p></div></div><div className="dashboard-toolbar">{can('USER_MANAGEMENT_VIEW')&&<Link to="/admin/approvals" className="btn btn-secondary">Review approvals</Link>}{can('SALES_CREATE')&&<Link to="/invoices" className="btn btn-secondary">New invoice</Link>}{can('ACCOUNTS_CREATE')&&<Link to="/expenses" className="btn btn-secondary">Log expense</Link>}{can('SECURITY_VIEW')&&<Link to="/gate-passes" className="btn btn-secondary">Gate passes</Link>}{user?.account_type==='staff'&&<Link to="/staff-workspace" className="btn btn-secondary">Attendance & tasks</Link>}<Link to="/notices" className="btn btn-secondary">View notices</Link></div></section>}
        </div>}
        {!loading&&!error&&!data&&<div className="empty-state"><h3>No dashboard data available</h3><p>Your permitted operational summaries will appear here.</p></div>}
    </div>;
}
