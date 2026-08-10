import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../lib/useApi';
import { api } from '../lib/apiClient';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import Pill from '../components/Pill';

const categories = ['Vendor / supplier bill','Official expense','Employee reimbursement','Travel allowance','Daily allowance','Food allowance','Transport','Accommodation','Utility','Labour','Medical','Other'];
const empty = { claimantType:'external', vendorBusinessId:'', employeeBusinessId:'', billNumber:'', billDate:'', category:'', payee:'', amount:'', description:'', expenseStartDate:'', expenseEndDate:'', preferredPaymentMethod:'bank' };

export default function BillSubmissionsPage() {
  const [searchParams,setSearchParams]=useSearchParams();
  const { data, reload } = useApi('/bills');
  const { data: vendors } = useApi('/vendors');
  const { data: employees } = useApi('/employees');
  const [show,setShow] = useState(false), [created,setCreated] = useState(null), [files,setFiles] = useState([]), [form,setForm] = useState(empty), [lines,setLines] = useState([{description:'',amount:''}]), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  useEffect(()=>{if(searchParams.get('create')==='1'){setShow(true);setSearchParams({}, {replace:true})}},[searchParams,setSearchParams]);
  const set = (key,value) => setForm(current => ({...current,[key]:value}));
  async function create(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { const expenseBreakdown=lines.filter(x=>x.description||x.amount).map(x=>({...x,amount:Number(x.amount||0)})); const r=await api.post('/bills',{...form,amount:Number(form.amount),expenseBreakdown}); setCreated(r.bill); }
    catch(x){setError(x.message)} finally{setBusy(false)}
  }
  async function uploadAndSubmit(){if(!files.length)return setError('At least one supporting document is required');setBusy(true);setError('');try{for(const file of files){const fd=new FormData();fd.append('file',file);fd.append('entityType','BILL_SUBMISSION');fd.append('entityId',created.business_id);await api.postForm('/attachments',fd)}await api.post(`/bills/${created.business_id}/submit`,{});setShow(false);setCreated(null);setForm(empty);setLines([{description:'',amount:''}]);reload()}catch(x){setError(x.message)}finally{setBusy(false)}}
  function close(){setShow(false);setCreated(null);setError('')}
  return <div>
    <div className="card-header" style={{marginBottom:18}}><div><h1 className="page-title">Bills & expense claims</h1><p className="card-subtitle">Submit supplier bills, official expenses, reimbursements and allowances with complete evidence.</p></div><button className="btn btn-primary" onClick={()=>{setShow(true);setCreated(null)}}>Submit claim</button></div>
    <div className="card"><DataTable rows={data?.bills||[]} columns={[
      {key:'business_id',label:'Claim',render:r=><Link to={`/bills/${r.business_id}`}>{r.business_id}</Link>},
      {key:'payee',label:'Payee / claimant'}, {key:'category',label:'Type'},
      {key:'amount',label:'Amount',render:r=>`BDT ${Number(r.amount).toLocaleString('en-BD')}`},
      {key:'attachment_count',label:'Documents'}, {key:'status',label:'Status',render:r=><Pill status={r.status}/>},
      {key:'open',label:'',render:r=><Link className="btn btn-secondary btn-sm" to={`/bills/${r.business_id}`}>Review details</Link>}
    ]}/></div>
    {show&&<Modal title="New bill or expense claim" onClose={close} wide>{error&&<div className="error-banner">{error}</div>}{!created?<form onSubmit={create}>
      <div className="form-grid">
        <div className="field"><label>Claim type</label><select value={form.claimantType} onChange={e=>set('claimantType',e.target.value)}><option value="external">External / other</option><option value="vendor">Vendor / supplier</option><option value="employee">Employee</option><option value="self">Personal official expense</option></select></div>
        {form.claimantType==='vendor'&&<div className="field"><label>Vendor</label><select value={form.vendorBusinessId} onChange={e=>{set('vendorBusinessId',e.target.value);const v=(vendors?.vendors||[]).find(x=>x.business_id===e.target.value);if(v)set('payee',v.name)}}><option value="">Select vendor</option>{(vendors?.vendors||[]).map(v=><option key={v.id} value={v.business_id}>{v.name}</option>)}</select></div>}
        {form.claimantType==='employee'&&<div className="field"><label>Employee</label><select value={form.employeeBusinessId} onChange={e=>{set('employeeBusinessId',e.target.value);const v=(employees?.employees||[]).find(x=>x.business_id===e.target.value);if(v)set('payee',v.full_name)}}><option value="">Select employee</option>{(employees?.employees||[]).map(v=><option key={v.id} value={v.business_id}>{v.full_name}</option>)}</select></div>}
        <div className="field"><label>Category *</label><select required value={form.category} onChange={e=>set('category',e.target.value)}><option value="">Select category</option>{categories.map(x=><option key={x}>{x}</option>)}</select></div>
        <div className="field"><label>Payee / claimant *</label><input required value={form.payee} onChange={e=>set('payee',e.target.value)}/></div>
        <div className="field"><label>Total amount *</label><input required type="number" min="0.01" step="0.01" value={form.amount} onChange={e=>set('amount',e.target.value)}/></div>
        <div className="field"><label>Bill / reference number</label><input value={form.billNumber} onChange={e=>set('billNumber',e.target.value)}/></div>
        <div className="field"><label>Bill date</label><input type="date" value={form.billDate} onChange={e=>set('billDate',e.target.value)}/></div>
        <div className="field"><label>Expense period from</label><input type="date" value={form.expenseStartDate} onChange={e=>set('expenseStartDate',e.target.value)}/></div>
        <div className="field"><label>Expense period to</label><input type="date" value={form.expenseEndDate} onChange={e=>set('expenseEndDate',e.target.value)}/></div>
        <div className="field"><label>Preferred payment</label><select value={form.preferredPaymentMethod} onChange={e=>set('preferredPaymentMethod',e.target.value)}><option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="mobile_banking">Mobile banking</option><option value="cheque">Cheque</option></select></div>
      </div>
      <div className="field"><label>Purpose and full description</label><textarea value={form.description} onChange={e=>set('description',e.target.value)}/></div>
      <div className="field"><label>Expense breakdown</label>{lines.map((line,i)=><div key={i} style={{display:'flex',gap:8,marginBottom:7}}><input placeholder="Expense item" value={line.description} onChange={e=>setLines(lines.map((x,j)=>j===i?{...x,description:e.target.value}:x))}/><input style={{maxWidth:150}} type="number" min="0" step="0.01" placeholder="Amount" value={line.amount} onChange={e=>setLines(lines.map((x,j)=>j===i?{...x,amount:e.target.value}:x))}/></div>)}<button type="button" className="btn btn-secondary btn-sm" onClick={()=>setLines([...lines,{description:'',amount:''}])}>Add line</button></div>
      <div className="form-actions"><button disabled={busy} className="btn btn-primary">{busy?'Creating…':'Continue to documents'}</button></div>
    </form>:<div><div className="success-banner">Draft {created.business_id} created. Upload all invoices, receipts and supporting documents.</div><div className="field"><label>Supporting documents * (multiple images/PDFs allowed)</label><input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={e=>setFiles([...e.target.files])}/><small>{files.length} file(s) selected</small></div><div className="form-actions"><Link className="btn btn-secondary" to={`/bills/${created.business_id}`}>Save draft</Link><button disabled={busy} className="btn btn-primary" onClick={uploadAndSubmit}>{busy?'Submitting…':'Upload and submit'}</button></div></div>}</Modal>}
  </div>
}
