import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../../lib/useApi';
import { api, downloadApiFile } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import Pill from '../../components/Pill';
import { IconPlus } from '../../components/Icons';

function emptyLine() { return { productBusinessId: '', batchBusinessId: '', quantity: '', unitPrice: '' }; }

function InvoiceAction({row}) {
    return <button className="btn btn-primary btn-sm" onClick={()=>downloadApiFile(`/documents/entity/FINANCIAL_INVOICE/${row.business_id}.pdf`,`${row.business_id}.pdf`)}>Download full invoice</button>;
}

export default function InvoicesPage() {
    const [searchParams,setSearchParams]=useSearchParams();
    const { can } = useAuth();
    const { data, loading, error, reload } = useApi('/sales/invoice-center');
    const mayCreate=['SALES_CREATE','COLD_STORAGE_CREATE','COLD_STORAGE_APPROVE','INVENTORY_CREATE','LOGISTICS_CREATE'].some(can);
    const { data: customersData } = useApi(mayCreate ? '/customers' : null);
    const { data: warehousesData } = useApi((can('SALES_CREATE')||can('INVENTORY_CREATE')) ? '/inventory/warehouses' : null);
    const { data: productsData } = useApi((can('SALES_CREATE')||can('INVENTORY_CREATE')) ? '/inventory/products' : null);
    const { data: batchesData } = useApi(can('SALES_CREATE') ? '/inventory/batches' : null);
    const { data: locationsData } = useApi((can('COLD_STORAGE_CREATE')||can('INVENTORY_CREATE')) ? '/cold-storage/locations' : null);
    const { data: policiesData } = useApi((can('COLD_STORAGE_CREATE')||can('COLD_STORAGE_APPROVE')||can('INVENTORY_CREATE')) ? '/cold-storage/rental-policies' : null);
    const { data: contractsData, reload:reloadContracts } = useApi((can('COLD_STORAGE_CREATE')||can('COLD_STORAGE_APPROVE')||can('INVENTORY_CREATE')) ? '/cold-storage/contracts' : null);
    const { data: salesInvoicesData } = useApi(can('LOGISTICS_CREATE') ? '/sales/invoices' : null);
    const { data: accountsData } = useApi(can('ACCOUNTS_CREATE') ? '/accounts' : null);

    const [showForm, setShowForm] = useState(false);
    const [showTypeSelector,setShowTypeSelector]=useState(false);
    const [workflowType,setWorkflowType]=useState(null);
    const [customerBusinessId, setCustomerBusinessId] = useState('');
    useEffect(()=>{const create=searchParams.get('create');if(!create)return;if(create==='sales')setShowForm(true);else if(['rent','contract','delivery','receiving'].includes(create))setWorkflowType(create);setSearchParams({}, {replace:true});},[searchParams,setSearchParams]);
    const [warehouseBusinessId, setWarehouseBusinessId] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [discount, setDiscount] = useState('0');
    const [tax, setTax] = useState('0');
    const [lines, setLines] = useState([emptyLine()]);
    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);
    const [typeFilter,setTypeFilter]=useState('ALL');
    const { data: customerContext } = useApi(customerBusinessId ? `/customers/${customerBusinessId}/billing-context` : null);

    const invoices = (data?.invoices || []).filter(row=>typeFilter==='ALL'||row.record_type===typeFilter);
    const customers = customersData?.customers || [];
    const warehouses = warehousesData?.warehouses || [];
    const products = productsData?.products || [];
    const batches = batchesData?.batches || [];
    const locations=locationsData?.locations||[],policies=policiesData?.policies||[],contracts=contractsData?.contracts||[],salesInvoices=salesInvoicesData?.invoices||[];

    const productByBusinessId = Object.fromEntries(products.map((p) => [p.business_id, p]));

    const updateLine = (idx, patch) => {
        setLines((ls) => ls.map((l, i) => {
            if (i !== idx) return l;
            const next = { ...l, ...patch };
            if (patch.productBusinessId) {
                const p = productByBusinessId[patch.productBusinessId];
                if (p) next.unitPrice = p.unit_price;
            }
            return next;
        }));
    };
    const addLine = () => setLines((ls) => [...ls, emptyLine()]);
    const removeLine = (idx) => setLines((ls) => ls.filter((_, i) => i !== idx));

    const subtotal = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
    const total = subtotal - (Number(discount) || 0) + (Number(tax) || 0);

    const resetForm = () => {
        setCustomerBusinessId(''); setWarehouseBusinessId(''); setDueDate(''); setDiscount('0'); setTax('0'); setLines([emptyLine()]); setFormError('');
    };
    const chooseInvoiceType=(type)=>{
        setShowTypeSelector(false);
        if(type==='sales'){resetForm();setShowForm(true);return;}
        setWorkflowType(type);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setBusy(true);
        setFormError('');
        try {
            const items = lines
                .filter((l) => l.productBusinessId && l.quantity)
                .map((l) => ({ productBusinessId: l.productBusinessId, batchBusinessId: l.batchBusinessId || undefined, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) }));
            if (items.length === 0) throw new Error('Add at least one line item');
            await api.post('/sales/invoices', { customerBusinessId, warehouseBusinessId, dueDate: dueDate || undefined, discount: Number(discount) || 0, tax: Number(tax) || 0, items });
            setShowForm(false);
            resetForm();
            reload();
        } catch (err) {
            setFormError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">Invoice center</h1>
                    <p className="card-subtitle">Sales, rent collection, goods receiving, rental contracts and delivery invoices in one place</p>
                </div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{can('COLD_STORAGE_VIEW')&&<button className="btn btn-secondary" onClick={()=>setWorkflowType(can('COLD_STORAGE_CREATE')?'contract':'rent')}>Rental contracts</button>}{mayCreate && (
                    <button type="button" className="btn btn-primary" onClick={() => setShowTypeSelector(true)}><IconPlus /> New invoice</button>
                )}</div>
            </div>

            <div className="card">
                <div className="field" style={{maxWidth:320}}><label>Invoice type</label><select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="ALL">All invoice types</option>{(data?.types||[]).map(type=><option key={type} value={type}>{type.replaceAll('_',' ')}</option>)}</select></div>
                {error && <div className="error-banner">{error}</div>}
                {loading ? <p style={{ color: 'var(--ink-600)' }}>Loading…</p> : (
                    <DataTable
                        columns={[
                            { key: 'business_id', label: 'Financial invoice', render: (r) => <div><Link className="mono" to={`/invoices/${r.business_id}`}><strong>{r.business_id}</strong></Link><div className="card-subtitle">Source: {r.source_business_id}</div></div> },
                            { key: 'record_type', label: 'Type', render:r=>r.record_type.replaceAll('_',' ') },
                            { key: 'party_name', label: 'Customer / organization', render:r=><div><strong>{r.party_name||'Company stock'}</strong>{r.customer_business_id&&<div className="card-subtitle">Received: {Number(r.total_received_quantity||0).toLocaleString()} · Deliveries: {r.total_deliveries}<br/>Rent: BDT {Number(r.total_rental_billed||0).toLocaleString()} · Contracts: BDT {Number(r.total_rental_contract_value||0).toLocaleString()}</div>}</div> },
                            { key: 'total', label: 'Total', align: 'right', render: (r) => <span className="num">৳{Number(r.total).toLocaleString()}</span> },
                            { key: 'status', label: 'Status', render: (r) => <Pill status={r.status} /> },
                            { key: 'payment_status', label: 'Payment', render: (r) => <Pill status={r.payment_status} /> },
                            { key: 'outstanding_amount', label: 'Due', align: 'right', render: (r) => <span className="num">৳{Number(r.outstanding_amount || 0).toLocaleString()}</span> },
                            { key: 'previous_due_snapshot', label: 'Previous due', align: 'right', render: (r) => <span className="num">৳{Number(r.previous_due_snapshot || 0).toLocaleString()}</span> },
                            { key: 'total_payable_snapshot', label: 'Total payable', align: 'right', render: (r) => <strong className="num">৳{Number(r.total_payable_snapshot || 0).toLocaleString()}</strong> },
                            { key: 'created_at', label: 'Date', render: (r) => new Date(r.created_at).toLocaleDateString() },
                            { key:'actions',label:'',render:r=><InvoiceAction row={r}/> }
                        ]}
                        rows={invoices}
                        emptyMessage="No invoices yet."
                    />
                )}
            </div>

            {showTypeSelector&&<Modal title="Select invoice type" onClose={()=>setShowTypeSelector(false)} wide>
                <p className="card-subtitle" style={{marginBottom:14}}>Choose the business document to generate. Each option opens its correct operational and accounting workflow.</p>
                <div className="form-grid">
                    {can('SALES_CREATE')&&<TypeChoice title="Sales invoice" text="Sell products, deduct stock and create customer receivable." onClick={()=>chooseInvoiceType('sales')}/>} 
                    {can('COLD_STORAGE_APPROVE')&&<TypeChoice title="Rent collection invoice" text="Select an active rental contract, calculate the billable period, create the customer receivable and issue the financial invoice." onClick={()=>chooseInvoiceType('rent')}/>} 
                    {can('INVENTORY_CREATE')&&<TypeChoice title="Goods receiving invoice" text="Receive customer or company goods, create the batch and receiving document." onClick={()=>chooseInvoiceType('receiving')}/>} 
                    {can('COLD_STORAGE_CREATE')&&<TypeChoice title="Rental contract" text="Create the customer rental contract used for recurring rent invoices." onClick={()=>chooseInvoiceType('contract')}/>} 
                    {can('LOGISTICS_CREATE')&&<TypeChoice title="Delivery invoice" text="Create a delivery linked to its customer, sales invoice and gate pass." onClick={()=>chooseInvoiceType('delivery')}/>} 
                </div>
                <div className="form-actions"><button className="btn btn-secondary" onClick={()=>setShowTypeSelector(false)}>Cancel</button></div>
            </Modal>}

            {showForm && (
                <Modal title="New sales invoice" onClose={() => setShowForm(false)} wide>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={handleSubmit}>
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="customer">Customer *</label>
                                <select id="customer" required value={customerBusinessId} onChange={(e) => setCustomerBusinessId(e.target.value)}>
                                    <option value="">Select a customer…</option>
                                    {customers.map((c) => <option key={c.id} value={c.business_id}>{c.business_id} — {c.name}</option>)}
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="warehouse">Ship from warehouse *</label>
                                <select id="warehouse" required value={warehouseBusinessId} onChange={(e) => setWarehouseBusinessId(e.target.value)}>
                                    <option value="">Select a warehouse…</option>
                                    {warehouses.map((w) => <option key={w.id} value={w.business_id}>{w.business_id} — {w.name}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="field"><label htmlFor="dueDate">Due date</label><input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /><span className="hint">Blank uses the customer credit period. Cash/bank changes only when payment is received.</span></div>
                        {customerContext&&<div className="card" style={{padding:14,marginBottom:14,background:'var(--paper-50)'}}><strong>Customer account context</strong><div className="stats-grid" style={{marginTop:10}}><div><span className="stat-label">Previous due</span><div className="stat-value">৳{Number(customerContext.summary.currentDue).toLocaleString()}</div></div><div><span className="stat-label">Estimated penalty</span><div className="stat-value">৳{Number(customerContext.summary.penalty).toLocaleString()}</div></div><div><span className="stat-label">Stored batches</span><div className="stat-value">{customerContext.batches.length}</div></div><div><span className="stat-label">Active contracts</span><div className="stat-value">{customerContext.contracts.filter(c=>c.status==='active').length}</div></div></div><p className="hint" style={{marginTop:8}}>Previous balances are shown for collection information only. This invoice creates a receivable for the new charges only.</p></div>}

                        <div className="field" style={{ marginTop: 6 }}>
                            <label>Line items *</label>
                            <div className="line-item-header" style={{gridTemplateColumns:'1.4fr 1.2fr .6fr .8fr .8fr 32px'}}><span>Product</span><span>Physical batch</span><span>Qty</span><span>Unit price</span><span>Line total</span><span /></div>
                            {lines.map((line, idx) => (
                                <div className="line-item-row" key={idx} style={{gridTemplateColumns:'1.4fr 1.2fr .6fr .8fr .8fr 32px'}}>
                                    <select value={line.productBusinessId} onChange={(e) => updateLine(idx, { productBusinessId: e.target.value })}>
                                        <option value="">Select product…</option>
                                        {products.map((p) => <option key={p.id} value={p.business_id}>{p.name}</option>)}
                                    </select>
                                    <select value={line.batchBusinessId} onChange={(e) => updateLine(idx, { batchBusinessId: e.target.value })}>
                                        <option value="">Unbatched/legacy stock</option>
                                        {batches.filter((b) => b.product_business_id === line.productBusinessId && Number(b.available_quantity) > 0).map((b) => <option key={b.id} value={b.business_id}>{b.business_id} ({Number(b.available_quantity).toLocaleString()} {b.unit})</option>)}
                                    </select>
                                    <input type="number" step="0.001" min="0" placeholder="0" value={line.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
                                    <input type="number" step="0.01" min="0" placeholder="0" value={line.unitPrice} onChange={(e) => updateLine(idx, { unitPrice: e.target.value })} />
                                    <span className="num" style={{ fontSize: 13 }}>৳{((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0)).toLocaleString()}</span>
                                    <button type="button" className="btn-ghost" onClick={() => removeLine(idx)} disabled={lines.length === 1}>✕</button>
                                </div>
                            ))}
                            <button type="button" className="btn btn-secondary btn-sm" onClick={addLine} style={{ marginTop: 4 }}><IconPlus /> Add line</button>
                        </div>

                        <div className="form-grid" style={{ marginTop: 14 }}>
                            <div className="field">
                                <label htmlFor="discount">Discount (৳)</label>
                                <input id="discount" type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                            </div>
                            <div className="field">
                                <label htmlFor="tax">Tax (৳)</label>
                                <input id="tax" type="number" step="0.01" value={tax} onChange={(e) => setTax(e.target.value)} />
                            </div>
                        </div>

                        <div className="totals-box">
                            <div className="row"><span>Subtotal</span><span className="num">৳{subtotal.toLocaleString()}</span></div>
                            <div className="row"><span>Discount</span><span className="num">− ৳{(Number(discount) || 0).toLocaleString()}</span></div>
                            <div className="row"><span>Tax</span><span className="num">+ ৳{(Number(tax) || 0).toLocaleString()}</span></div>
                            <div className="row total"><span>Total</span><span className="num">৳{total.toLocaleString()}</span></div>
                        </div>

                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create invoice'}</button>
                        </div>
                    </form>
                </Modal>
            )}
            {workflowType&&<InvoiceWorkflowModal type={workflowType} onClose={()=>setWorkflowType(null)} onCreated={()=>{setWorkflowType(null);reload();reloadContracts?.()}} customers={customers} accounts={accountsData?.accounts||[]} warehouses={warehouses} products={products} locations={locations} policies={policies} contracts={contracts} salesInvoices={salesInvoices}/>} 
        </div>
    );
}

function TypeChoice({title,text,onClick}){return <button type="button" className="card" onClick={onClick} style={{textAlign:'left',cursor:'pointer',border:'1px solid var(--border)',padding:16}}><strong style={{display:'block',marginBottom:6}}>{title}</strong><span className="card-subtitle">{text}</span></button>}

function InvoiceWorkflowModal({type,onClose,onCreated,customers,accounts,warehouses,products,locations,policies,contracts,salesInvoices}){
 const today=new Date().toISOString().slice(0,10),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [form,setForm]=useState(type==='rent'?{customerBusinessId:'',selectedReceivableIds:[],laborCharge:'0',serviceCharge:'0',otherCharge:'0',otherDescription:'',discount:'0',tax:'0',paymentMode:'commitment',amountReceived:'0',accountBusinessId:'',paymentMethod:'cash',paymentReference:'',paymentDate:today,commitmentAmount:'',commitmentDate:'',commitmentNotes:''}:type==='contract'?{customerBusinessId:'',storageLocationBusinessId:'',rentalPolicyBusinessId:'',unitQuantity:'',goodsDescription:'',startDate:today}:type==='delivery'?{invoiceBusinessId:'',deliveryAddress:'',scheduledDate:today,vehicleNumber:'',contactName:'',contactPhone:''}:{ownerCustomerBusinessId:'',productBusinessId:'',warehouseBusinessId:'',locationBusinessId:'',rentalPolicyBusinessId:'',contractBusinessId:'',quantity:'',lotNumber:'',rentPerUnitPerCycle:'',billingCycle:'monthly',laborAmount:'0',serviceAmount:'0',conditionNotes:'',acknowledgementName:''});
 const {data:rentContext}=useApi(type==='rent'&&form.customerBusinessId?`/sales/rent-collection/context/${form.customerBusinessId}`:null);
 const set=(key,value)=>setForm(current=>({...current,[key]:value}));
 const selectedTotal=(rentContext?.dues||[]).filter(x=>form.selectedReceivableIds.includes(x.id)).reduce((n,x)=>n+Number(x.outstanding_amount),0),newChargeTotal=Number(form.laborCharge||0)+Number(form.serviceCharge||0)+Number(form.otherCharge||0)-Number(form.discount||0)+Number(form.tax||0),totalPayable=selectedTotal+newChargeTotal;
 async function submit(e){e.preventDefault();setBusy(true);setError('');try{if(type==='rent'){const manualCharges=[['LABOR','Labor charge',form.laborCharge],['SERVICE','Service charge',form.serviceCharge],['OTHER_SERVICE',form.otherDescription||'Other service charge',form.otherCharge]].filter(x=>Number(x[2])>0).map(x=>({type:x[0],description:x[1],amount:Number(x[2])}));const result=await api.post('/sales/rent-collection',{...form,manualCharges,discount:Number(form.discount||0),tax:Number(form.tax||0),amountReceived:form.paymentMode==='full'?totalPayable:Number(form.amountReceived||0),commitmentAmount:form.commitmentAmount?Number(form.commitmentAmount):undefined});alert(`Rent collection invoice ${result.financialInvoiceBusinessId} created${result.receiptBusinessId?` with money receipt ${result.receiptBusinessId}`:''}.`);}else if(type==='contract')await api.post('/cold-storage/contracts',{...form,unitQuantity:Number(form.unitQuantity)});else if(type==='delivery'){const result=await api.post('/logistics/deliveries',form);alert(`Delivery invoice created. Stock deducted and mandatory gate pass ${result.gatePassBusinessId} issued.`)}else await api.post('/inventory/batches',{...form,quantity:Number(form.quantity),rentPerUnitPerCycle:form.rentPerUnitPerCycle===''?undefined:Number(form.rentPerUnitPerCycle),laborAmount:Number(form.laborAmount||0),serviceAmount:Number(form.serviceAmount||0),warehouseBusinessId:form.locationBusinessId?undefined:form.warehouseBusinessId});onCreated()}catch(x){setError(x.message)}finally{setBusy(false)}}
 const titles={rent:'Generate rent collection invoice',contract:'Create rental contract invoice',delivery:'Create delivery invoice',receiving:'Issue goods receiving note (GRN)'};
 return <Modal title={titles[type]} onClose={onClose} wide>{error&&<div className="error-banner">{error}</div>}<form onSubmit={submit}>
  {type==='rent'&&<><div className="field"><label>Customer / organization *</label><select required value={form.customerBusinessId} onChange={e=>setForm(x=>({...x,customerBusinessId:e.target.value,selectedReceivableIds:[]}))}><option value="">Select customer</option>{customers.map(x=><option key={x.id} value={x.business_id}>{x.business_id} — {x.name}</option>)}</select></div>{form.customerBusinessId&&<><div className="card" style={{padding:14,marginBottom:14}}><div style={{display:'flex',justifyContent:'space-between',gap:12}}><strong>Outstanding rent and charges</strong><button type="button" className="btn btn-secondary" onClick={()=>set('selectedReceivableIds',(rentContext?.dues||[]).map(x=>x.id))}>Select all</button></div>{(rentContext?.dues||[]).length===0?<p className="card-subtitle">No outstanding dues. You may add a new authorized charge below.</p>:(rentContext?.dues||[]).map(x=><label key={x.id} style={{display:'grid',gridTemplateColumns:'24px 1fr auto',gap:8,padding:'9px 0',borderBottom:'1px solid var(--border)'}}><input type="checkbox" checked={form.selectedReceivableIds.includes(x.id)} onChange={e=>set('selectedReceivableIds',e.target.checked?[...form.selectedReceivableIds,x.id]:form.selectedReceivableIds.filter(id=>id!==x.id))}/><span><strong>{x.category}</strong> — {x.description||x.source_id}<small style={{display:'block'}}>Due {x.due_date?new Date(x.due_date).toLocaleDateString():'—'} · {x.source_id}</small></span><strong>BDT {Number(x.outstanding_amount).toLocaleString()}</strong></label>)}</div><div className="form-grid"><div className="field"><label>Labor charge</label><input type="number" min="0" step="0.01" value={form.laborCharge} onChange={e=>set('laborCharge',e.target.value)}/></div><div className="field"><label>Other service charge</label><input type="number" min="0" step="0.01" value={form.serviceCharge} onChange={e=>set('serviceCharge',e.target.value)}/></div><div className="field"><label>Other charge</label><input type="number" min="0" step="0.01" value={form.otherCharge} onChange={e=>set('otherCharge',e.target.value)}/></div><div className="field"><label>Other charge description</label><input value={form.otherDescription} onChange={e=>set('otherDescription',e.target.value)}/></div><div className="field"><label>Authorized discount</label><input type="number" min="0" step="0.01" value={form.discount} onChange={e=>set('discount',e.target.value)}/></div><div className="field"><label>Tax</label><input type="number" min="0" step="0.01" value={form.tax} onChange={e=>set('tax',e.target.value)}/></div></div><div className="card" style={{padding:14,marginBottom:14}}><strong>Selected previous due: BDT {selectedTotal.toLocaleString()} · New charges: BDT {newChargeTotal.toLocaleString()} · Total payable: BDT {totalPayable.toLocaleString()}</strong></div><div className="form-grid"><div className="field"><label>Collection status *</label><select value={form.paymentMode} onChange={e=>set('paymentMode',e.target.value)}><option value="commitment">No payment — commitment</option><option value="partial">Partial payment</option><option value="full">Full payment</option></select></div>{form.paymentMode!=='commitment'&&<><div className="field"><label>Amount received *</label><input required={form.paymentMode==='partial'} disabled={form.paymentMode==='full'} type="number" min="0.01" max={totalPayable} step="0.01" value={form.paymentMode==='full'?totalPayable:form.amountReceived} onChange={e=>set('amountReceived',e.target.value)}/></div><div className="field"><label>Receiving account *</label><select required value={form.accountBusinessId} onChange={e=>set('accountBusinessId',e.target.value)}><option value="">Select cash/bank account</option>{accounts.map(x=><option key={x.id} value={x.business_id}>{x.name} — {x.account_type}</option>)}</select></div><div className="field"><label>Payment method</label><select value={form.paymentMethod} onChange={e=>set('paymentMethod',e.target.value)}><option value="cash">Cash</option><option value="bank">Bank</option><option value="mobile_banking">Mobile banking</option><option value="cheque">Cheque</option></select></div><div className="field"><label>Reference</label><input value={form.paymentReference} onChange={e=>set('paymentReference',e.target.value)}/></div><div className="field"><label>Payment date</label><input type="date" value={form.paymentDate} onChange={e=>set('paymentDate',e.target.value)}/></div></>}</div>{form.paymentMode!=='full'&&<><h4>Customer payment commitment</h4><div className="form-grid"><div className="field"><label>Committed amount</label><input type="number" min="0" step="0.01" value={form.commitmentAmount} onChange={e=>set('commitmentAmount',e.target.value)}/></div><div className="field"><label>Committed payment date</label><input type="date" value={form.commitmentDate} onChange={e=>set('commitmentDate',e.target.value)}/></div></div><div className="field"><label>Commitment notes</label><textarea value={form.commitmentNotes} onChange={e=>set('commitmentNotes',e.target.value)}/></div></>}</>}</>}
  {type==='contract'&&<><div className="field"><label>Customer / organization *</label><select required value={form.customerBusinessId} onChange={e=>set('customerBusinessId',e.target.value)}><option value="">Select customer</option>{customers.map(x=><option key={x.id} value={x.business_id}>{x.business_id} — {x.name}</option>)}</select></div><div className="form-grid"><div className="field"><label>Storage location *</label><select required value={form.storageLocationBusinessId} onChange={e=>set('storageLocationBusinessId',e.target.value)}><option value="">Select location</option>{locations.map(x=><option key={x.id} value={x.business_id}>{x.location_type} — {x.name}</option>)}</select></div><div className="field"><label>Rental policy *</label><select required value={form.rentalPolicyBusinessId} onChange={e=>set('rentalPolicyBusinessId',e.target.value)}><option value="">Select policy</option>{policies.map(x=><option key={x.id} value={x.business_id}>{x.name} — BDT {Number(x.rate_per_unit_per_cycle).toLocaleString()} / {x.unit_type} / {x.billing_cycle}</option>)}</select></div><div className="field"><label>Contract quantity *</label><input required type="number" min="0.01" step="0.01" value={form.unitQuantity} onChange={e=>set('unitQuantity',e.target.value)}/></div><div className="field"><label>Start date</label><input type="date" value={form.startDate} onChange={e=>set('startDate',e.target.value)}/></div></div><div className="field"><label>Goods / product description</label><textarea value={form.goodsDescription} onChange={e=>set('goodsDescription',e.target.value)}/></div></>}
  {type==='delivery'&&<><div className="field"><label>Issued sales invoice *</label><select required value={form.invoiceBusinessId} onChange={e=>set('invoiceBusinessId',e.target.value)}><option value="">Select invoice</option>{salesInvoices.filter(x=>x.status==='issued').map(x=><option key={x.id} value={x.business_id}>{x.business_id} — {x.customer_name} — BDT {Number(x.total).toLocaleString()}</option>)}</select></div><div className="field"><label>Delivery address</label><textarea value={form.deliveryAddress} onChange={e=>set('deliveryAddress',e.target.value)}/></div><div className="field"><label>Scheduled date</label><input type="date" value={form.scheduledDate} onChange={e=>set('scheduledDate',e.target.value)}/></div></>}
  {type==='receiving'&&<><div className="form-grid"><div className="field"><label>Owner customer / organization</label><select value={form.ownerCustomerBusinessId} onChange={e=>set('ownerCustomerBusinessId',e.target.value)}><option value="">Company-owned stock</option>{customers.map(x=><option key={x.id} value={x.business_id}>{x.name}</option>)}</select></div><div className="field"><label>Product *</label><select required value={form.productBusinessId} onChange={e=>set('productBusinessId',e.target.value)}><option value="">Select product</option>{products.map(x=><option key={x.id} value={x.business_id}>{x.name} ({x.unit})</option>)}</select></div><div className="field"><label>Exact storage location</label><select value={form.locationBusinessId} onChange={e=>set('locationBusinessId',e.target.value)}><option value="">Use warehouse only</option>{locations.map(x=><option key={x.id} value={x.business_id}>{x.name}</option>)}</select></div><div className="field"><label>Receiving warehouse *</label><select required={!form.locationBusinessId} value={form.warehouseBusinessId} onChange={e=>set('warehouseBusinessId',e.target.value)}><option value="">Select warehouse</option>{warehouses.map(x=><option key={x.id} value={x.business_id}>{x.name}</option>)}</select></div><div className="field"><label>Rental contract</label><select value={form.contractBusinessId} onChange={e=>set('contractBusinessId',e.target.value)}><option value="">No contract</option>{contracts.filter(x=>x.status==='active').map(x=><option key={x.id} value={x.business_id}>{x.business_id} — {x.customer_name}</option>)}</select></div><div className="field"><label>Rental policy</label><select value={form.rentalPolicyBusinessId} onChange={e=>set('rentalPolicyBusinessId',e.target.value)}><option value="">Product/default rate</option>{policies.map(x=><option key={x.id} value={x.business_id}>{x.name}</option>)}</select></div><div className="field"><label>Received quantity *</label><input required type="number" min="0.001" step="0.001" value={form.quantity} onChange={e=>set('quantity',e.target.value)}/></div><div className="field"><label>Lot / batch number</label><input value={form.lotNumber} onChange={e=>set('lotNumber',e.target.value)}/></div><div className="field"><label>Rent per unit / cycle</label><input type="number" min="0" step="0.01" value={form.rentPerUnitPerCycle} onChange={e=>set('rentPerUnitPerCycle',e.target.value)}/></div><div className="field"><label>Billing cycle</label><select value={form.billingCycle} onChange={e=>set('billingCycle',e.target.value)}><option>daily</option><option>weekly</option><option>monthly</option><option>yearly</option></select></div><div className="field"><label>Labour cost</label><input type="number" min="0" step="0.01" value={form.laborAmount} onChange={e=>set('laborAmount',e.target.value)}/></div><div className="field"><label>Other service charge</label><input type="number" min="0" step="0.01" value={form.serviceAmount} onChange={e=>set('serviceAmount',e.target.value)}/></div></div><div className="field"><label>Condition / receiving notes</label><textarea value={form.conditionNotes} onChange={e=>set('conditionNotes',e.target.value)}/></div><div className="field"><label>Acknowledged by</label><input value={form.acknowledgementName} onChange={e=>set('acknowledgementName',e.target.value)}/></div></>}
  <div className="form-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button disabled={busy} className="btn btn-primary">{busy?'Processing…':type==='receiving'?'Issue GRN':type==='rent'?'Generate invoice':'Create'}</button></div>
 </form></Modal>
}
