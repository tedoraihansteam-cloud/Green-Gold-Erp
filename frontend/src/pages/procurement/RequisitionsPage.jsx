import {useEffect,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {useApi} from '../../lib/useApi';
import {api} from '../../lib/apiClient';
import {useAuth} from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import Pill from '../../components/Pill';

const types=['OFFICE_SUPPLY','INVENTORY','RAW_MATERIAL','MACHINERY','ELECTRICAL','IT_EQUIPMENT','FURNITURE','TOOL','SPARE_PART','MAINTENANCE','SAFETY','SERVICE','OTHER'];
const blank=()=>({itemType:'OFFICE_SUPPLY',description:'',quantity:'',unit:'unit',estimatedUnitCost:'',specification:''});
const initial=()=>({title:'',justification:'',priority:'normal',requiredDate:'',destinationType:'',destinationBusinessId:'',destinationName:'',items:[blank()]});

export default function RequisitionsPage(){
 const [searchParams,setSearchParams]=useSearchParams();
 const {can}=useAuth(),{data,reload}=useApi('/procurement/requisitions'),{data:destData}=useApi('/procurement/destinations');
 const [show,setShow]=useState(false),[form,setForm]=useState(initial()),[error,setError]=useState('');
 useEffect(()=>{if(searchParams.get('create')==='1'){setShow(true);setSearchParams({}, {replace:true})}},[searchParams,setSearchParams]);
 const dests=destData?.destinations||[];
 const setItem=(i,p)=>setForm(x=>({...x,items:x.items.map((v,n)=>n===i?{...v,...p}:v)}));
 const submit=async e=>{e.preventDefault();try{setError('');await api.post('/procurement/requisitions',{...form,items:form.items.map(x=>({...x,quantity:Number(x.quantity),estimatedUnitCost:Number(x.estimatedUnitCost||0)}))});setShow(false);setForm(initial());reload()}catch(x){setError(x.message)}};
 const review=async(row,decision)=>{const notes=prompt(`${decision} remarks (required)`);if(!notes)return;try{await api.post(`/procurement/requisitions/${row.business_id}/review`,{decision,notes});reload()}catch(x){alert(x.message)}};
 return <div><div className="card-header"><div><h1 className="page-title">Purchase requisitions</h1><p className="card-subtitle">Request office supplies, equipment, machinery, services, consumables or operational materials.</p></div><button className="btn btn-primary" onClick={()=>setShow(true)}>New requisition</button></div>
 <div className="card"><DataTable rows={data?.requisitions||[]} emptyMessage="No purchase requisitions." columns={[
  {key:'business_id',label:'Requisition',render:r=><Link to={`/procurement/requisitions/${r.business_id}`}>{r.business_id}</Link>},{key:'title',label:'Need'},{key:'requester_name',label:'Requested by'},{key:'destination_name',label:'Receiver'},{key:'required_date',label:'Required',render:r=>r.required_date?new Date(r.required_date).toLocaleDateString():'—'},{key:'estimated_total',label:'Estimate',render:r=>`BDT ${Number(r.estimated_total).toLocaleString()}`},{key:'status',label:'Status',render:r=><Pill status={r.status}/>},{key:'actions',label:'',render:r=><div style={{display:'flex',gap:5}}><Link className="btn btn-secondary btn-sm" to={`/procurement/requisitions/${r.business_id}`}>Open</Link>{['submitted','reviewed'].includes(r.status)&&(can('INVENTORY_APPROVE')||can('USER_MANAGEMENT_APPROVE'))&&<>{r.status==='submitted'&&<button className="btn btn-secondary btn-sm" onClick={()=>review(r,'review')}>Review</button>}<button className="btn btn-primary btn-sm" onClick={()=>review(r,'approve')}>Approve</button></>}</div>}
 ]}/></div>
 {show&&<Modal title="New purchase requisition" onClose={()=>setShow(false)} wide>{error&&<div className="error-banner">{error}</div>}<form onSubmit={submit}>
  <div className="form-grid"><div className="field"><label>What is needed? *</label><input required value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></div><div className="field"><label>Priority</label><select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}><option>normal</option><option>urgent</option><option>critical</option></select></div><div className="field"><label>Required date</label><input type="date" value={form.requiredDate} onChange={e=>setForm({...form,requiredDate:e.target.value})}/></div><div className="field"><label>Receiving destination *</label><select required value={`${form.destinationType}|${form.destinationBusinessId}`} onChange={e=>{const [type,id]=e.target.value.split('|'),d=dests.find(x=>x.type===type&&x.business_id===id);setForm({...form,destinationType:type,destinationBusinessId:id,destinationName:d?.name||''})}}><option value="|">Select receiving location, department or staff</option>{dests.map((d,i)=><option key={`${d.type}-${d.business_id}-${i}`} value={`${d.type}|${d.business_id}`}>{d.type} — {d.name}</option>)}</select></div></div>
  <div className="field"><label>Business justification *</label><textarea required value={form.justification} onChange={e=>setForm({...form,justification:e.target.value})}/></div><h3>Requested items</h3>{form.items.map((x,i)=><div className="card" key={i} style={{padding:12}}><div className="form-grid"><select value={x.itemType} onChange={e=>setItem(i,{itemType:e.target.value})}>{types.map(v=><option key={v}>{v}</option>)}</select><input required placeholder="Item description" value={x.description} onChange={e=>setItem(i,{description:e.target.value})}/><input required type="number" min="0.001" step="0.001" placeholder="Quantity" value={x.quantity} onChange={e=>setItem(i,{quantity:e.target.value})}/><input placeholder="Unit" value={x.unit} onChange={e=>setItem(i,{unit:e.target.value})}/><input type="number" min="0" step="0.01" placeholder="Estimated unit cost" value={x.estimatedUnitCost} onChange={e=>setItem(i,{estimatedUnitCost:e.target.value})}/><input placeholder="Specification / preferred brand" value={x.specification} onChange={e=>setItem(i,{specification:e.target.value})}/></div></div>)}<button type="button" className="btn btn-secondary" onClick={()=>setForm({...form,items:[...form.items,blank()]})}>Add item</button><div className="form-actions"><button className="btn btn-primary">Submit requisition</button></div>
 </form></Modal>}</div>;
}
