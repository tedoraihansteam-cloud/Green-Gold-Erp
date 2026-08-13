import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../lib/useApi';
import { api } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
import {
    IconDashboard, IconCustomers, IconVendors, IconEmployees, IconInventory, IconSales,
    IconAccounts, IconExpenses, IconBudget, IconSecurity, IconColdStorage, IconManufacturing, IconLogistics,
    IconReports, IconAdmin, IconNotices, IconLogout, IconGrain
} from './Icons';
import StaffTaskBar from './StaffTaskBar';

const NAV = [
    { group: 'Overview', items: [
        { to: '/', label: 'Dashboard', icon: IconDashboard, always: true },
        { to: '/staff-workspace', label: 'My attendance & tasks', icon: IconEmployees, staffOnly: true },
        { to: '/reports', label: 'Reports', icon: IconReports, always: true },
        { to: '/notices', label: 'Notices', icon: IconNotices, always: true }
        ,{ to: '/requests', label: 'My letters & requests', customerLabel: 'Bookings & delivery requests', icon: IconNotices, always: true }
        ,{ to: '/bills', label: 'Bill submission', icon: IconExpenses, always: true, notCustomer: true }
        ,{ to: '/scan', label: 'Scan QR / barcode', icon: IconSecurity, always: true, notCustomer: true }
        ,{ to: '/customer-portal', label: 'My account & dues', icon: IconCustomers, customerOnly: true }
    ]},
    { group: 'Sales', items: [
        { to: '/customers', label: 'Customers', icon: IconCustomers, perm: 'SALES_VIEW' },
        { to: '/invoices', label: 'Invoice center', icon: IconSales, anyPerm: ['SALES_VIEW','COLD_STORAGE_VIEW','INVENTORY_VIEW','LOGISTICS_VIEW','ACCOUNTS_VIEW'] }
    ]},
    { group: 'Inventory', items: [
        { to: '/inventory/products', label: 'Products', icon: IconInventory, perm: 'INVENTORY_VIEW' },
        { to: '/inventory/warehouses', label: 'Warehouses', icon: IconInventory, perm: 'INVENTORY_VIEW' },
        { to: '/inventory/stock', label: 'Stock balances', icon: IconInventory, perm: 'INVENTORY_VIEW' },
        { to: '/inventory/batches', label: 'Batches & locations', icon: IconInventory, perm: 'INVENTORY_VIEW' },
        { to: '/procurement/purchase-orders', label: 'Purchase orders', icon: IconVendors, perm: 'INVENTORY_VIEW' },
        { to: '/procurement/requisitions', label: 'Purchase requisitions', icon: IconVendors },
        { to: '/vendors', label: 'Vendors', icon: IconVendors, perm: 'INVENTORY_VIEW' }
    ]},
    { group: 'HR', items: [
        { to: '/admin/departments', label: 'Departments', icon: IconEmployees, anyPerm: ['HR_VIEW','USER_MANAGEMENT_VIEW'] },
        { to: '/staff-workspace', label: 'Attendance & task reports', icon: IconEmployees, perm: 'HR_VIEW' },
        { to: '/employees', label: 'Employees', icon: IconEmployees, perm: 'HR_VIEW' },
        { to: '/hr/payroll', label: 'Payroll pay orders', icon: IconEmployees, anyPerm: ['HR_VIEW','ACCOUNTS_VIEW'] },
        { to: '/hr/salary-templates', label: 'Salary templates', icon: IconEmployees, perm: 'HR_VIEW' }
    ]},
    { group: 'Accounts', items: [
        { to: '/accounts', label: 'Cash & bank', icon: IconAccounts, perm: 'ACCOUNTS_VIEW' },
        { to: '/accounts/receivables', label: 'Customer dues', icon: IconAccounts, perm: 'ACCOUNTS_VIEW' },
        { to: '/accounts/balance-sheet', label: 'Balance sheet', icon: IconAccounts, perm: 'ACCOUNTS_VIEW' },
        { to: '/accounts/general-ledger', label: 'General ledger', icon: IconAccounts, perm: 'ACCOUNTS_VIEW' },
        { to: '/accounts/financial-closing', label: 'Closing & reconciliation', icon: IconAccounts, perm: 'ACCOUNTS_VIEW' },
        { to: '/expenses', label: 'Expenses', icon: IconExpenses, perm: 'ACCOUNTS_VIEW' },
        { to: '/budgets', label: 'Budgets', icon: IconBudget, perm: 'BUDGET_VIEW' }
    ]},
    { group: 'Security', items: [
        { to: '/gate-passes', label: 'Gate passes', icon: IconSecurity, perm: 'SECURITY_VIEW' }
    ]},
    { group: 'Cold storage', items: [
        { to: '/cold-storage/locations', label: 'Storage locations', icon: IconColdStorage, perm: 'COLD_STORAGE_VIEW' },
        { to: '/cold-storage/policies', label: 'Rental policies', icon: IconColdStorage, perm: 'COLD_STORAGE_VIEW' },
        { to: '/cold-storage/contracts', label: 'Contracts', icon: IconColdStorage, perm: 'COLD_STORAGE_VIEW' }
        ,{ to: '/cold-storage/charges', label: 'Labor & service charges', icon: IconColdStorage, perm: 'COLD_STORAGE_VIEW' }
    ]},
    { group: 'Manufacturing', items: [
        { to: '/manufacturing/shift-reports', label: 'Machine shift reports', icon: IconManufacturing, perm: 'MANUFACTURING_VIEW' },
        { to: '/manufacturing/machines', label: 'Machines', icon: IconManufacturing, perm: 'MANUFACTURING_VIEW' },
        { to: '/manufacturing/incidents', label: 'Incidents', icon: IconManufacturing, perm: 'MANUFACTURING_VIEW' }
    ]},
    { group: 'Logistics', items: [
        { to: '/logistics/vehicles', label: 'Vehicles', icon: IconLogistics, perm: 'LOGISTICS_VIEW' },
        { to: '/logistics/deliveries', label: 'Deliveries', icon: IconLogistics, perm: 'LOGISTICS_VIEW' }
    ]},
    { group: 'Admin', items: [
        { to: '/admin/approvals', label: 'Approvals', icon: IconAdmin, perm: 'USER_MANAGEMENT_VIEW' },
        { to: '/admin/roles', label: 'Roles', icon: IconAdmin, perm: 'USER_MANAGEMENT_VIEW' },
        { to: '/admin/users', label: 'Users', icon: IconAdmin, perm: 'USER_MANAGEMENT_VIEW' }
        ,{ to: '/admin/data-corrections', label: 'Data corrections', icon: IconAdmin, anyPerm: ['USER_MANAGEMENT_VIEW','USER_MANAGEMENT_EDIT'] }
        ,{ to: '/admin/integration-hub', label: 'Integration & devices', icon: IconAdmin, perm: 'USER_MANAGEMENT_VIEW' }
    ]}
];
const BN={Overview:'সংক্ষিপ্ত বিবরণ',Dashboard:'ড্যাশবোর্ড',Reports:'রিপোর্ট',Notices:'নোটিশ','My letters & requests':'আমার আবেদন','Bill submission':'বিল জমা','Scan QR / barcode':'কিউআর / বারকোড স্ক্যান','My account & dues':'আমার হিসাব ও বকেয়া',Sales:'বিক্রয়',Customers:'গ্রাহক',Invoices:'ইনভয়েস',Inventory:'ইনভেন্টরি',Products:'পণ্য',Warehouses:'গুদাম','Stock balances':'স্টক ব্যালেন্স','Batches & locations':'ব্যাচ ও অবস্থান',Vendors:'ভেন্ডর',HR:'এইচআর',Employees:'কর্মচারী',Payroll:'পেরোল','Salary templates':'বেতন কাঠামো',Accounts:'হিসাব','Cash & bank':'নগদ ও ব্যাংক','Customer dues':'গ্রাহক বকেয়া','Balance sheet':'ব্যালেন্স শিট',Expenses:'খরচ',Budgets:'বাজেট',Security:'নিরাপত্তা','Gate passes':'গেট পাস','Cold storage':'কোল্ড স্টোরেজ','Storage locations':'স্টোরেজ অবস্থান','Rental policies':'ভাড়া নীতি',Contracts:'চুক্তি','Labor & service charges':'শ্রম ও সেবা চার্জ',Manufacturing:'উৎপাদন',Machines:'মেশিন',Incidents:'ঘটনা',Logistics:'লজিস্টিকস',Vehicles:'যানবাহন',Deliveries:'ডেলিভারি',Admin:'অ্যাডমিন',Approvals:'অনুমোদন',Roles:'ভূমিকা',Users:'ব্যবহারকারী'};

Object.assign(BN, {
    'My attendance & tasks':'আমার উপস্থিতি ও কাজ',
    Overview:'সারসংক্ষেপ', Dashboard:'ড্যাশবোর্ড', Reports:'রিপোর্ট', Notices:'নোটিশ',
    'My letters & requests':'আমার চিঠি ও অনুরোধ', 'Bill submission':'বিল জমা', 'Scan QR / barcode':'QR / বারকোড স্ক্যান', 'My account & dues':'আমার হিসাব ও বকেয়া',
    Sales:'বিক্রয়', Customers:'গ্রাহক', 'Invoice center':'ইনভয়েস কেন্দ্র', Inventory:'ইনভেন্টরি', Products:'পণ্য', Warehouses:'গুদাম', 'Stock balances':'স্টক ব্যালেন্স', 'Batches & locations':'ব্যাচ ও অবস্থান', 'Purchase orders':'ক্রয় আদেশ', 'Purchase requisitions':'ক্রয় চাহিদা', Vendors:'সরবরাহকারী',
    HR:'এইচআর', Departments:'বিভাগ', 'Attendance & task reports':'উপস্থিতি ও কাজের রিপোর্ট', Employees:'কর্মচারী', 'Payroll pay orders':'বেতন পরিশোধ আদেশ', 'Salary templates':'বেতন কাঠামো',
    Accounts:'হিসাব', 'Cash & bank':'নগদ ও ব্যাংক', 'Customer dues':'গ্রাহক বকেয়া', 'Balance sheet':'ব্যালেন্স শিট', 'General ledger':'সাধারণ খতিয়ান', 'Closing & reconciliation':'সমাপনী ও সমন্বয়', Expenses:'খরচ', Budgets:'বাজেট',
    Security:'নিরাপত্তা', 'Gate passes':'গেট পাস', 'Cold storage':'কোল্ড স্টোরেজ', 'Storage locations':'সংরক্ষণ স্থান', 'Rental policies':'ভাড়া নীতি', Contracts:'চুক্তি', 'Labor & service charges':'শ্রম ও সেবা চার্জ',
    Manufacturing:'উৎপাদন', 'Machine shift reports':'মেশিন শিফট রিপোর্ট', Machines:'মেশিন', Incidents:'ঘটনা', Logistics:'লজিস্টিকস', Vehicles:'যানবাহন', Deliveries:'ডেলিভারি',
    Admin:'অ্যাডমিন', Approvals:'অনুমোদন', Roles:'ভূমিকা', Users:'ব্যবহারকারী', 'Data corrections':'তথ্য সংশোধন', 'Integration & devices':'ইন্টিগ্রেশন ও ডিভাইস'
});

export default function Layout() {
    const { user, can, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [showCreateMenu, setShowCreateMenu] = useState(false);
    const [mobileNav, setMobileNav] = useState(false);
    const [commandOpen, setCommandOpen] = useState(false);
    const [commandQuery, setCommandQuery] = useState('');
    const [entityResults, setEntityResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchError, setSearchError] = useState('');
    const [previewPrefs, setPreviewPrefs] = useState(() => { try { return JSON.parse(localStorage.getItem('ggerp:appearance') || 'null'); } catch { return null; } });
    const { data: profileData } = useApi('/users/me');
    const { data: companyData } = useApi('/company-settings');
    const { data: runtimeData } = useApi('/settings/runtime');
    const effectivePrefs = { ...(profileData?.profile?.preferences || {}), ...(previewPrefs || {}) };
    const locale=effectivePrefs.locale||'en-BD';const tr=(value)=>locale==='bn-BD'?(BN[value]||value):value;

    useEffect(() => {
        const prefs = profileData?.profile?.preferences || {};
        document.documentElement.dataset.theme = prefs.theme || 'system';
        document.documentElement.dataset.accent = prefs.accent || 'green';
        document.documentElement.dataset.density = prefs.density || 'comfortable';
        document.documentElement.dataset.sidebar = prefs.sidebarMode || 'expanded';
        document.documentElement.dataset.reducedMotion = String(!!prefs.reducedMotion);
        document.documentElement.dataset.largerText = String(!!prefs.largerText);
        document.documentElement.dataset.highContrast = String(!!prefs.highContrast);
        document.documentElement.lang = prefs.locale === 'bn-BD' ? 'bn' : 'en';
    }, [profileData]);

    useEffect(() => {
        const onKey = (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(true); }
            if (event.key === 'Escape') { setCommandOpen(false); setShowUserMenu(false); setMobileNav(false); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);
    useEffect(() => setMobileNav(false), [location.pathname]);
    useEffect(() => {
        if (!commandOpen) return;
        const dialog = document.querySelector('.command-dialog');
        if (dialog) dialog.setAttribute('aria-label', 'Universal ERP search dialog');
    }, [commandOpen]);
    useEffect(() => {
        const onPreview = (event) => setPreviewPrefs(event.detail || null);
        window.addEventListener('ggerp:preferences-preview', onPreview);
        return () => window.removeEventListener('ggerp:preferences-preview', onPreview);
    }, []);
    useEffect(() => {
        if (!commandOpen || commandQuery.trim().length < 2) { setEntityResults([]); setSearchLoading(false); setSearchError(''); return; }
        let active = true;
        const timer = setTimeout(async () => {
            setSearchLoading(true);
            setSearchError('');
            try { const response = await api.get(`/search?q=${encodeURIComponent(commandQuery.trim())}`); if (active) setEntityResults(response.results || []); }
            catch (error) { if (active) { setEntityResults([]); setSearchError(error.message || 'Universal search is unavailable'); } }
            finally { if (active) setSearchLoading(false); }
        }, 220);
        return () => { active = false; clearTimeout(timer); };
    }, [commandOpen, commandQuery]);

    useEffect(() => {
        const minutes=Number(runtimeData?.controls?.inactivityMinutes||15);
        let timer;
        const reset=()=>{window.clearTimeout(timer);timer=window.setTimeout(()=>{logout();navigate('/login',{replace:true,state:{message:`Signed out after ${minutes} minutes of inactivity.`}});},minutes*60000);};
        const events=['pointerdown','keydown','scroll','touchstart'];events.forEach(name=>window.addEventListener(name,reset,{passive:true}));reset();
        return()=>{window.clearTimeout(timer);events.forEach(name=>window.removeEventListener(name,reset));};
    },[runtimeData,logout,navigate]);

    const handleLogout = () => { logout(); navigate('/login'); };
    const toggleSidebar = () => {
        const sidebarMode = ['collapsed', 'icon-only'].includes(effectivePrefs.sidebarMode) ? 'expanded' : 'collapsed';
        const next = { ...effectivePrefs, sidebarMode };
        setPreviewPrefs(next);
        document.documentElement.dataset.sidebar = sidebarMode;
        try {
            const cached = JSON.parse(localStorage.getItem('ggerp:appearance') || '{}');
            localStorage.setItem('ggerp:appearance', JSON.stringify({ ...cached, sidebarMode }));
        } catch { localStorage.setItem('ggerp:appearance', JSON.stringify({ sidebarMode })); }
    };
    const settingsMenu = [
        ['/admin/settings/company', 'Company identity & branding'], ['/admin/settings/locations', 'Office & factory locations'],
        ['/admin/settings/api', 'API connections'], ['/admin/settings/workflow', 'Workflow & individual duties'],
        ['/admin/settings/upload', 'Universal data upload'], ['/admin/settings/smtp', 'Email service'],
        ['/admin/settings/ai_integration', 'AI & document reading'], ['/admin/settings/theme', 'Company theme'],
        ['/admin/settings/language', 'Language'], ['/admin/settings/rental_penalty', 'Rental & penalty defaults'],
        ['/admin/settings/barcode_print', 'QR & barcode printing'], ['/admin/settings/notifications', 'Message alerts'],
        ['/admin/integration-hub', 'Integration & Device Hub']
    ];
    const selectedScope = companyData?.sites?.find((site) => site.id === effectivePrefs.operationalScopeId)
        || companyData?.sites?.find((site) => site.is_document_address) || companyData?.sites?.[0];
    const createActions = [
        can('SALES_CREATE') && ['Sales invoice','/invoices?create=sales','Sales'], can('COLD_STORAGE_CREATE') && ['Rent collection','/invoices?create=rent','Sales'],
        can('COLD_STORAGE_CREATE') && ['Rental contract','/invoices?create=contract','Sales'], can('INVENTORY_CREATE') && ['Goods receiving / GRN','/invoices?create=receiving','Inventory'],
        can('LOGISTICS_CREATE') && ['Delivery invoice','/invoices?create=delivery','Logistics'], can('SALES_CREATE') && ['Customer','/customers?create=1','Master data'],
        can('INVENTORY_CREATE') && ['Vendor','/vendors?create=1','Master data'], can('INVENTORY_CREATE') && ['Product','/inventory/products?create=1','Master data'],
        user?.account_type !== 'customer' && ['Purchase requisition','/procurement/requisitions?create=1','Requests'], user?.account_type !== 'customer' && ['Bill / expense claim','/bills?create=1','Finance'],
        can('ACCOUNTS_CREATE') && ['Expense payment','/expenses?create=1','Finance'], can('SECURITY_CREATE') && ['Gate pass','/gate-passes?create=1','Security'],
        user?.account_type !== 'customer' && ['Scan QR / barcode','/scan','Scanner']
    ].filter(Boolean);
    const visibleNav = useMemo(() => NAV.flatMap((group) => group.items.filter((item) => {
        if (item.customerOnly) return user?.account_type === 'customer';
        if (item.staffOnly) return user?.account_type === 'staff';
        if (item.notCustomer && user?.account_type === 'customer') return false;
        return item.always || can(item.perm) || item.anyPerm?.some(can) || (!item.perm && !item.anyPerm);
    }).map((item) => ({ ...item, group: group.group }))), [user, can]);
    const localCommands = [
        ...visibleNav.map((item) => ({ label: item.label, group: item.group, to: item.to })),
        ...(can('SALES_CREATE') ? [{ label: 'Create invoice', group: 'Quick create', to: '/invoices' }] : []),
        ...(can('ACCOUNTS_CREATE') ? [{ label: 'Record expense', group: 'Quick create', to: '/expenses' }] : []),
        ...(can('SECURITY_VIEW') ? [{ label: 'Open gate pass', group: 'Quick create', to: '/gate-passes' }] : []),
        { label: 'Change my appearance', group: 'Settings', to: '/profile' }
    ].filter((item) => `${item.label} ${item.group}`.toLowerCase().includes(commandQuery.toLowerCase())).slice(0, 14);
    const commands = [...entityResults.map((item) => ({ label: item.title, group: `${item.entityType} · ${item.businessId}`, detail: [item.subtitle,item.status].filter(Boolean).join(' · '), to: item.path })), ...localCommands].slice(0, 40);
    const openCommand = (to) => { setCommandOpen(false); setCommandQuery(''); navigate(to); };
    const prefs = effectivePrefs;
    const collapsed = ['collapsed', 'icon-only'].includes(prefs.sidebarMode);

    return (
        <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}${mobileNav ? ' mobile-nav-open' : ''}`}>
            <aside className="sidebar">
                <div className="sidebar-header">
                    <div className="sidebar-brand-row"><span className="wordmark"><IconGrain className="grain" /><span><span className="green">Green</span> <span className="gold">Gold</span></span></span><button className="icon-button desktop-collapse-button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleSidebar}>{collapsed ? '›' : '‹'}</button><button className="icon-button mobile-menu-button" aria-label="Close navigation" onClick={() => setMobileNav(false)}>×</button></div>
                    <button className="scope-switcher" type="button" title="Choose operational scope" onClick={() => navigate('/profile#operational-scope')}><strong>{companyData?.profile?.name || 'Green Gold ERP'}</strong><small>{selectedScope?.name || 'All permitted locations'} · Current scope</small></button>
                </div>
                <input className="sidebar-search" aria-label="Filter navigation" placeholder="Find a module…" onFocus={() => setCommandOpen(true)} readOnly />
                <nav style={{ flex: 1, overflowY: 'auto' }}>
                    {NAV.map((group) => {
                        const visibleItems = group.items.filter((item) => {
                            if (item.customerOnly) return user?.account_type === 'customer';
                            if (item.staffOnly) return user?.account_type === 'staff';
                            if (item.notCustomer && user?.account_type === 'customer') return false;
                            return item.always || can(item.perm) || item.anyPerm?.some(can) || (!item.perm && !item.anyPerm);
                        });
                        if (visibleItems.length === 0) return null;
                        return (
                            <div className="nav-group" key={group.group}>
                                <div className="nav-group-label">{tr(group.group)}</div>
                                {visibleItems.map((item) => (
                                    <NavLink
                                        key={item.to}
                                        to={item.to}
                                        end={item.to === '/'}
                                        className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                                    >
                                        <item.icon /> <span>{tr(user?.account_type === 'customer' && item.customerLabel ? item.customerLabel : item.label)}</span>
                                    </NavLink>
                                ))}
                            </div>
                        );
                    })}
                </nav>
                <button type="button" className="nav-link" style={{ border: 'none', background: 'transparent', width: '100%', cursor: 'pointer' }} onClick={handleLogout}>
                    <IconLogout /> {locale==='bn-BD'?'লগ আউট':'Log out'}
                </button>
            </aside>
            <div className="main">
                <div className="topbar">
                    <button className="icon-button mobile-menu-button" aria-label="Open navigation" onClick={() => setMobileNav(true)}>☰</button>
                    <span className="wordmark on-light"><IconGrain /><span className="green">Green</span> <span className="gold">Gold</span> <span style={{ fontFamily: 'var(--font-body)', fontStyle: 'normal', fontSize: 13, fontWeight: 500, color: 'var(--ink-600)', marginLeft: 4 }}>ERP</span></span>
                    <div className="topbar-search" role="search"><span className="search-glyph">⌕</span><input aria-label="Global search" placeholder="Search customers, employees, invoices, products, gate passes…" onFocus={() => setCommandOpen(true)} readOnly /><kbd>Ctrl K</kbd></div>
                    <div className="topbar-right">
                        {user?.account_type === 'staff' ? <StaffTaskBar /> : null}
                        <div style={{position:'relative'}}><button className="btn btn-primary btn-sm" aria-expanded={showCreateMenu} onClick={() => setShowCreateMenu((v)=>!v)}>+ <span className="topbar-action-label">Create</span></button>{showCreateMenu&&<div className="popover quick-create-popover"><div className="nav-group-label">CREATE NEW</div>{createActions.map(([label,to,group])=><button key={label} type="button" className="nav-link" onClick={()=>{setShowCreateMenu(false);navigate(to)}}><span><strong>{label}</strong><small>{group}</small></span></button>)}</div>}</div>
                        {can('USER_MANAGEMENT_VIEW') && <button className="icon-button" aria-label="Approvals" title="Approvals" onClick={() => navigate('/admin/approvals')}>✓</button>}
                        <button className="icon-button" aria-label="Notifications" title="Notifications" onClick={() => navigate('/notices')}>♢</button>
                        <span style={{ fontSize: 13, color: 'var(--ink-600)' }}>
                            {user?.username} · {user?.roles?.join(', ') || user?.account_type}
                        </span>
                        <div style={{ position: 'relative' }}>
                            <button type="button" className="btn btn-secondary btn-sm" aria-label="Profile and settings menu" onClick={() => setShowUserMenu((v) => !v)}>⋮</button>
                            {showUserMenu && <div className="popover">
                                <div style={{ padding: '8px 10px 12px', borderBottom: '1px solid var(--border)', marginBottom: 6 }}><strong>{profileData?.profile?.display_name || user?.username}</strong><div className="hint">{user?.roles?.join(', ') || user?.account_type}</div></div>
                                <button type="button" className="nav-link" style={{ border: 0, background: 'transparent', width: '100%', cursor: 'pointer' }} onClick={() => { setShowUserMenu(false); navigate('/profile'); }}>My profile & settings</button>
                                {can('USER_MANAGEMENT_VIEW') && <><div className="nav-group-label" style={{ padding: '12px 10px 5px' }}>APPLICATION SETTINGS</div>{settingsMenu.map(([to, label]) => <button key={to} type="button" className="nav-link" style={{ border: 0, background: 'transparent', width: '100%', cursor: 'pointer', textAlign: 'left' }} onClick={() => { setShowUserMenu(false); navigate(to); }}>{label}</button>)}</>}
                                {user?.account_type !== 'customer' && <button type="button" className="nav-link" style={{ border: 0, background: 'transparent', width: '100%', cursor: 'pointer' }} onClick={() => { setShowUserMenu(false); navigate('/scan'); }}>Scan QR / barcode</button>}
                                <button type="button" className="nav-link" style={{ border: 0, background: 'transparent', width: '100%', cursor: 'pointer' }} onClick={handleLogout}>Log out</button>
                            </div>}
                        </div>
                    </div>
                </div>
                <div className="content">
                    <Outlet />
                </div>
            </div>
            {commandOpen && <div className="command-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCommandOpen(false); }}><div className="command-dialog" role="dialog" aria-modal="true" aria-label="Universal ERP search"><input autoFocus value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} placeholder="Search any business ID, person, product, invoice or document…" aria-label="Universal ERP search" /><div className="command-results">{searchLoading && <div className="command-search-status">Searching permitted ERP records…</div>}{searchError && <div className="error-banner" role="alert">Search service error: {searchError}. Close this window and reopen Green Gold ERP once.</div>}{commands.map((item, index) => <button className={`command-item${index === 0 ? ' active' : ''}`} key={`${item.to}-${item.group}-${item.label}`} onClick={() => openCommand(item.to)}><span><strong>{item.label}</strong>{item.detail && <small className="command-detail">{item.detail}</small>}</span><small>{item.group}</small></button>)}{!searchLoading&&!searchError&&!commands.length && <div className="empty-state"><h3>No permitted result</h3><p>Check the business ID or try a name, phone, reference or description.</p></div>}</div></div></div>}
        </div>
    );
}
