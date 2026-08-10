import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Pill from '../../components/Pill';
import { EntityDocumentActions } from '../../components/DocumentActions';

export default function RequisitionDetailPage(){
  const {businessId}=useParams(),{can}=useAuth(),{data,loading,error,reload}=useApi(`/procurement/requisitions/${businessId}`),[busy,setBusy]=useState(false);
  const r=data?.requisition;
  const act=async decision=>{const notes=prompt(`${decision} remarks (required)`);if(!notes)return;try{setBusy(true);await api.post(`/procurement/requisitions/${businessId}/review`,{decision,notes});reload()}catch(e){alert(e.message)}finally{setBusy(false)}};
  if(loading)return <p>Loading…</p>;if(error)return <div className="error-banner">{error}</div>;if(!r)return null;
  const mayReview=data.reviewer&&(can('INVENTORY_APPROVE')||can('USER_MANAGEMENT_APPROVE'))&&['submitted','reviewed'].includes(r.status);
  return <div><Link className="breadcrumb-link" to="/procurement/requisitions">← All requisitions</Link>
    <div className="card-header"><div><h1 className="page-title">{r.business_id} — {r.title}</h1><p className="card-subtitle">Complete requisition slip, review history and linked purchasing progress</p></div><Pill status={r.status}/></div>
    <div className="stat-grid"><div className="stat-card"><div className="label">Requested by</div><div className="value">{r.requester_name}</div></div><div className="stat-card"><div className="label">Department</div><div className="value">{r.department_name||'Not assigned'}</div></div><div className="stat-card"><div className="label">Receiving destination</div><div className="value">{r.destination_name}</div><small>{r.location_address||''}</small></div><div className="stat-card"><div className="label">Estimated total</div><div className="value">BDT {Number(r.estimated_total).toLocaleString()}</div></div></div>
    <div className="card"><h3>Request details</h3><p><strong>Justification:</strong> {r.justification}</p><p><strong>Priority:</strong> {r.priority} &nbsp; <strong>Required:</strong> {r.required_date?new Date(r.required_date).toLocaleDateString():'Not specified'}</p>{r.review_notes&&<p><strong>Latest review remarks:</strong> {r.review_notes}</p>}</div>
    <div className="card"><h3>Requested items</h3><DataTable rows={r.items||[]} columns={[{key:'item_type',label:'Type'},{key:'item_description',label:'Description'},{key:'specification',label:'Specification'},{key:'quantity',label:'Quantity',render:x=>`${x.quantity} ${x.unit}`},{key:'estimated_unit_cost',label:'Unit estimate',render:x=>`BDT ${Number(x.estimated_unit_cost).toLocaleString()}`},{key:'quantity_ordered',label:'Ordered'}]}/></div>
    {mayReview&&<div className="card"><h3>Review and approval</h3><div style={{display:'flex',gap:8}}>{r.status==='submitted'&&<button disabled={busy} className="btn btn-secondary" onClick={()=>act('review')}>Review</button>}<button disabled={busy} className="btn btn-primary" onClick={()=>act('approve')}>Approve</button><button disabled={busy} className="btn btn-secondary" onClick={()=>act('return')}>Return</button><button disabled={busy} className="btn btn-danger" onClick={()=>act('reject')}>Reject</button></div></div>}
    <div className="card"><div className="card-header"><h3>Linked purchase orders</h3>{r.status==='approved'&&can('INVENTORY_CREATE')&&<Link className="btn btn-primary" to={`/procurement/purchase-orders?requisition=${r.business_id}`}>Create purchase order</Link>}</div><DataTable rows={r.purchaseOrders||[]} emptyMessage="No purchase order created yet." columns={[{key:'business_id',label:'PO',render:x=><Link to={`/procurement/purchase-orders/${x.business_id}`}>{x.business_id}</Link>},{key:'vendor_name',label:'Vendor',render:x=><Link to={`/vendors/${x.vendor_business_id}`}>{x.vendor_name}</Link>},{key:'quantity_ordered',label:'Ordered'},{key:'quantity_received',label:'Received'},{key:'total',label:'Total',render:x=>`BDT ${Number(x.total).toLocaleString()}`},{key:'status',label:'Status',render:x=><Pill status={x.status}/>} ]}/></div>
    <div className="card"><h3>Workflow history</h3><DataTable rows={r.auditTrail||[]} emptyMessage="No workflow actions recorded." columns={[{key:'created_at',label:'Date',render:x=>new Date(x.created_at).toLocaleString()},{key:'action',label:'Action'},{key:'actor_username',label:'By'},{key:'after_data',label:'Remarks',render:x=>x.after_data?.notes||'—'}]}/></div>
  </div>;
}
