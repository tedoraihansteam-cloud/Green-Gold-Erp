import {useState} from 'react';
import {Link} from 'react-router-dom';
import {useApi} from '../../lib/useApi';
import {useAuth} from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import ReportWorkflow from './ReportWorkflow';

const localDate=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const money=v=>`৳${Number(v||0).toLocaleString()}`;
const sectionTitles={accounts:'Account inflow and outflow',expenses:'Expenses and deductions',receiving:'Products received / GRN',stockReleases:'Products delivered or released',deliveries:'Delivery and vehicle activity',gatePasses:'Vehicle and gate-pass entry/exit',attendance:'Staff attendance and hours',tasks:'Every assigned task report',machineIncidents:'Machinery incidents',maintenance:'Maintenance activity',requests:'Departmental requests and approvals'};

function columnsFor(name){const common={
 accounts:[['created_at','Time'],['account_name','Account'],['transaction_type','Movement'],['reference_type','Source'],['reference_id','Reference'],['amount','Amount']],
 expenses:[['business_id','Expense'],['category','Category'],['description','Description'],['paid_to','Paid to'],['account_name','Account'],['amount','Amount'],['status','Status']],
 receiving:[['created_at','Time'],['business_id','GRN'],['batch_business_id','Batch'],['product_name','Product'],['customer_name','Customer'],['received_quantity','Quantity'],['unit','Unit']],
 stockReleases:[['created_at','Time'],['business_id','Release'],['batch_business_id','Batch'],['product_name','Product'],['quantity','Released'],['remaining_quantity','Remaining']],
 deliveries:[['business_id','Delivery'],['customer_name','Customer'],['vehicle_number','Vehicle'],['status','Status'],['scheduled_date','Scheduled'],['dispatched_at','Out'],['delivered_at','Delivered'],['delivery_address','Destination']],
 gatePasses:[['business_id','Gate pass'],['pass_type','Type'],['vehicle_number','Vehicle'],['contact_name','Driver/contact'],['status','Status'],['created_at','Issued/in'],['exit_confirmed_at','Exit'],['exit_note','Exit report']],
 attendance:[['staff_name','Staff'],['status','Attendance status'],['clock_in_at','First clock in'],['clock_out_at','Last clock out'],['hours','Hours'],['attendance_mode','Mode'],['location_address','Location'],['clock_in_ip','Clock-in IP'],['clock_out_ip','Clock-out IP']],
 tasks:[['business_id','Task'],['title','Title'],['description','Instructions / report'],['assignee','Individual'],['assigned_by','Assigned by'],['priority','Priority'],['status','Status'],['progress_percent','Progress'],['logged_minutes','Minutes'],['due_date','Due'],['completed_at','Completed']],
 machineIncidents:[['business_id','Incident'],['machine_name','Machine'],['incident_type','Type'],['severity','Severity'],['status','Status'],['description','Report'],['reported_at','Reported'],['resolved_at','Resolved'],['resolution_notes','Resolution']],
 maintenance:[['machine_name','Machine'],['maintenance_type','Type'],['scheduled_date','Scheduled'],['completed_date','Completed'],['status','Status'],['notes','Report']],
 requests:[['business_id','Request'],['request_type','Type'],['department','Department'],['subject','Subject'],['requester','Requester'],['status','Status'],['created_at','Submitted']]
};return (common[name]||[]).map(([key,label])=>({key,label,render:r=>key==='amount'?money(r[key]):key==='progress_percent'?`${r[key]}%`:key.includes('_at')&&r[key]?new Date(r[key]).toLocaleString():r[key]??'—'}));}

export default function ReportsPage(){
 const {can}=useAuth(),[date,setDate]=useState(localDate());
 const canAccounts=can('ACCOUNTS_VIEW'),canSales=can('SALES_VIEW'),canInventory=can('INVENTORY_VIEW'),canCold=can('COLD_STORAGE_VIEW'),canLogistics=can('LOGISTICS_VIEW');
 const {data:daily}=useApi(canAccounts?`/daily-financial-reports/preview?date=${date}`:null);
 const {data:financial}=useApi(canAccounts?`/reports/financial-summary?startDate=${date}&endDate=${date}`:null);
 const {data:sales}=useApi(canSales?`/reports/sales-summary?startDate=${date}&endDate=${date}`:null);
 const {data:inventory}=useApi(canInventory?'/reports/inventory-status':null);
 const {data:cold}=useApi(canCold?`/reports/cold-storage-occupancy?startDate=${date}&endDate=${date}`:null);
 const {data:delivery}=useApi(canLogistics?`/reports/delivery-performance?startDate=${date}&endDate=${date}`:null);
 const {data:operations,loading,error}=useApi(`/reports/operational-daily?date=${date}`);
 const sections=operations?.sections||{};
 return <div><div className="card-header" style={{marginBottom:18}}><div><h1 className="page-title">Permission-based reports center</h1><p className="card-subtitle">Financial, operational, staff, vehicle, inventory, machinery and management reports appear only when your permissions allow them.</p></div><div className="field" style={{margin:0}}><label>Operational date</label><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></div></div>{error&&<div className="error-banner">{error}</div>}
 {canAccounts&&<ReportWorkflow date={date} canCreate={can('ACCOUNTS_CREATE')} canApprove={can('ACCOUNTS_APPROVE')} availableSections={daily?.availableSections}/>}
 {canAccounts&&<><section className="card"><div className="card-header"><div><h2>Financial and full-balance report</h2><p className="card-subtitle">Opening/closing cash, income, expense, payroll, deductions and reconciliation.</p></div><Link className="btn btn-primary" to="/accounts/balance-sheet">Open full balance sheet</Link></div><div className="stat-grid"><div className="stat-card"><div className="label">Opening</div><div className="value">{money(daily?.summary?.opening)}</div></div><div className="stat-card"><div className="label">Incoming</div><div className="value">{money(daily?.summary?.incoming)}</div></div><div className="stat-card"><div className="label">Outgoing</div><div className="value">{money(daily?.summary?.outgoing)}</div></div><div className="stat-card"><div className="label">Closing</div><div className="value">{money(daily?.summary?.closing)}</div></div><div className="stat-card"><div className="label">Expenses</div><div className="value">{money(financial?.expenses)}</div></div><div className="stat-card"><div className="label">Payroll</div><div className="value">{money(financial?.payroll)}</div></div></div></section></>}
 {canSales&&<section className="card"><h2>Sales report</h2><div className="stat-grid"><div className="stat-card"><div className="label">Invoices</div><div className="value">{sales?.invoiceCount||0}</div></div><div className="stat-card"><div className="label">Revenue</div><div className="value">{money(sales?.totalRevenue)}</div></div></div></section>}
 {canInventory&&<section className="card"><div className="card-header"><h2>Current inventory report</h2><span>{inventory?.lowStockCount||0} low-stock products</span></div><DataTable rows={inventory?.products||[]} columns={[{key:'business_id',label:'Product'},{key:'name',label:'Name'},{key:'current_stock',label:'Stock'},{key:'unit',label:'Unit'},{key:'reorder_level',label:'Reorder level'},{key:'low_stock',label:'Alert',render:r=>r.low_stock?'Low stock':'OK'}]}/></section>}
 {canCold&&<section className="card"><div className="card-header"><h2>Cold-storage and rental report</h2><span>{cold?.activeContracts||0} active contracts · {money(cold?.revenueInPeriod)} billed</span></div><DataTable rows={cold?.byLocation||[]} columns={[{key:'business_id',label:'Location'},{key:'name',label:'Name'},{key:'location_type',label:'Type'},{key:'occupied_quantity',label:'Occupied'},{key:'capacity_value',label:'Capacity'},{key:'capacity_unit',label:'Unit'}]}/></section>}
 {canLogistics&&<section className="card"><h2>Delivery performance</h2><div className="stat-grid"><div className="stat-card"><div className="label">Total</div><div className="value">{delivery?.total||0}</div></div><div className="stat-card"><div className="label">In transit</div><div className="value">{delivery?.inTransit||0}</div></div><div className="stat-card"><div className="label">Delivered</div><div className="value">{delivery?.delivered||0}</div></div><div className="stat-card"><div className="label">Failed</div><div className="value">{delivery?.failed||0}</div></div></div></section>}
 <h2 style={{margin:'24px 0 12px'}}>Daily departmental and management report</h2>{loading?<p>Loading…</p>:Object.entries(sections).map(([name,rows])=><section className="card" key={name}><div className="card-header"><h2>{sectionTitles[name]||name}</h2><span className="card-subtitle">{rows.length} record(s)</span></div><DataTable rows={rows} columns={columnsFor(name)} emptyMessage={`No ${sectionTitles[name]||name} for this date.`}/></section>)}{!loading&&!Object.keys(sections).length&&<div className="card">No departmental report permission is assigned to this user.</div>}</div>;
}
