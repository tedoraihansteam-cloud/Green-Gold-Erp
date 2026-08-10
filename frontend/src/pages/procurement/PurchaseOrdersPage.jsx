import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import Pill from '../../components/Pill';
import { IconPlus } from '../../components/Icons';

function emptyLine() { return { productBusinessId:'',description:'',itemType:'OFFICE_SUPPLY',receivingAction:'CONSUMABLE',unit:'unit',quantity:'',unitPrice:'' }; }

export default function PurchaseOrdersPage() {
    const [searchParams] = useSearchParams();
    const { can } = useAuth();
    const { data, loading, error, reload } = useApi('/procurement/purchase-orders');
    const { data: vendorsData, reload: reloadVendors } = useApi('/vendors');
    const { data: warehousesData } = useApi('/inventory/warehouses');
    const { data: productsData } = useApi('/inventory/products');
    const {data:reqData}=useApi('/procurement/requisitions');
    const {data:destData}=useApi('/procurement/destinations');

    const [showForm, setShowForm] = useState(false);
    const [vendorBusinessId, setVendorBusinessId] = useState('');
    const [warehouseBusinessId, setWarehouseBusinessId] = useState('');
    const [purchaseMeta,setPurchaseMeta]=useState({requisitionBusinessId:'',purchaseType:'OFFICE_SUPPLY',destinationType:'',destinationBusinessId:'',destinationName:'',emergencyPurchase:false,emergencyReason:''});
    const [tax, setTax] = useState('0');
    const [lines, setLines] = useState([emptyLine()]);
    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);
    const [createVendor,setCreateVendor]=useState(false);
    const [newVendor,setNewVendor]=useState({name:'',phone:'',email:'',address:'',vendorType:''});

    const purchaseOrders = data?.purchaseOrders || [];
    const vendors = vendorsData?.vendors || [];
    const warehouses = warehousesData?.warehouses || [];
    const products = productsData?.products || [];

    useEffect(()=>{const id=searchParams.get('requisition');if(!id||!reqData?.requisitions)return;const r=reqData.requisitions.find(x=>x.business_id===id);if(!r)return;setPurchaseMeta(m=>({...m,requisitionBusinessId:id,destinationType:r.destination_type||'',destinationBusinessId:r.destination_business_id||'',destinationName:r.destination_name||''}));const remaining=(r.items||[]).filter(x=>Number(x.quantity)>Number(x.quantity_ordered||0)).map(x=>({productBusinessId:'',description:x.item_description,itemType:x.item_type||'OTHER',receivingAction:x.item_type==='SERVICE'?'SERVICE':['MACHINERY','ELECTRICAL','IT_EQUIPMENT','FURNITURE'].includes(x.item_type)?'ASSET':'CONSUMABLE',unit:x.unit||'unit',quantity:String(Number(x.quantity)-Number(x.quantity_ordered||0)),unitPrice:String(x.estimated_unit_cost||''),requisitionItemId:x.id}));if(remaining.length)setLines(remaining);setShowForm(true)},[reqData,searchParams]);

    const updateLine = (idx, patch) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    const addLine = () => setLines((ls) => [...ls, emptyLine()]);
    const removeLine = (idx) => setLines((ls) => ls.filter((_, i) => i !== idx));

    const subtotal = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
    const total = subtotal + (Number(tax) || 0);

    const resetForm = () => { setVendorBusinessId(''); setWarehouseBusinessId('');setPurchaseMeta({requisitionBusinessId:'',purchaseType:'OFFICE_SUPPLY',destinationType:'',destinationBusinessId:'',destinationName:'',emergencyPurchase:false,emergencyReason:''});setTax('0');setLines([emptyLine()]);setFormError(''); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setBusy(true); setFormError('');
        try {
            const items = lines
                .filter((l) => (l.productBusinessId||l.description) && l.quantity && l.unitPrice)
                .map((l) => ({...l,quantity:Number(l.quantity),unitPrice:Number(l.unitPrice)}));
            if (items.length === 0) throw new Error('Add at least one line item with a unit price');
            let selectedVendor=vendorBusinessId;
            if(createVendor){const name=newVendor.name.trim()||prompt('New vendor name');if(!name)throw new Error('New vendor name is required');const created=await api.post('/vendors',{...newVendor,name,phone:newVendor.phone||prompt('Vendor phone (optional)')||'',address:newVendor.address||prompt('Vendor address (optional)')||''});selectedVendor=created.vendor.business_id;await reloadVendors();}
            await api.post('/procurement/purchase-orders', {vendorBusinessId:selectedVendor,warehouseBusinessId:warehouseBusinessId||undefined,...purchaseMeta,tax:Number(tax)||0,items});
            setShowForm(false);
            resetForm();
            reload();
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">Purchase orders</h1>
                    <p className="card-subtitle">Ordering from vendors — receive goods against these to bring stock in</p>
                </div>
                {can('INVENTORY_CREATE') && (
                    <button type="button" className="btn btn-primary" onClick={() => { resetForm(); setShowForm(true); }}><IconPlus /> New purchase order</button>
                )}
            </div>

            <div className="card">
                {error && <div className="error-banner">{error}</div>}
                {loading ? <p style={{ color: 'var(--ink-600)' }}>Loading…</p> : (
                    <DataTable
                        columns={[
                            { key: 'business_id', label: 'PO', render: (r) => <Link to={`/procurement/purchase-orders/${r.business_id}`} className="mono" style={{ color: 'var(--husk-700)', fontWeight: 600 }}>{r.business_id}</Link> },
                            { key: 'vendor_name', label: 'Vendor', render: r => <Link to={`/vendors/${r.vendor_business_id}`}>{r.vendor_business_id} — {r.vendor_name}</Link> },
                            {key:'purchase_type',label:'Purchase type'},{key:'destination_name',label:'Receiver'},
                            { key: 'total', label: 'Total', align: 'right', render: (r) => <span className="num">৳{Number(r.total).toLocaleString()}</span> },
                            { key: 'status', label: 'Status', render: (r) => <Pill status={r.status} /> },
                            { key: 'payment_status', label: 'Payment', render: (r) => <Pill status={r.payment_status} /> },
                            { key: 'created_at', label: 'Date', render: (r) => new Date(r.created_at).toLocaleDateString() }
                        ]}
                        rows={purchaseOrders}
                        emptyMessage="No purchase orders yet."
                    />
                )}
            </div>

            {showForm && (
                <Modal title="New purchase order" onClose={() => setShowForm(false)} wide>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={handleSubmit}>
                        {createVendor&&<div className="card"><h3>New vendor — this will be added to Vendor List</h3><div className="form-grid"><div className="field"><label>Name *</label><input required value={newVendor.name} onChange={e=>setNewVendor({...newVendor,name:e.target.value})}/></div><div className="field"><label>Type</label><input value={newVendor.vendorType} onChange={e=>setNewVendor({...newVendor,vendorType:e.target.value})}/></div><div className="field"><label>Phone</label><input value={newVendor.phone} onChange={e=>setNewVendor({...newVendor,phone:e.target.value})}/></div><div className="field"><label>Email</label><input type="email" value={newVendor.email} onChange={e=>setNewVendor({...newVendor,email:e.target.value})}/></div></div><div className="field"><label>Address</label><textarea value={newVendor.address} onChange={e=>setNewVendor({...newVendor,address:e.target.value})}/></div></div>}
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="poVendor">Vendor *</label>
                                <select id="poVendor" required={!createVendor} value={createVendor?'__new__':vendorBusinessId} onChange={(e) => {setCreateVendor(e.target.value==='__new__');setVendorBusinessId(e.target.value==='__new__'?'':e.target.value)}}>
                                    <option value="">Select a vendor…</option>
                                    <option value="__new__">+ Create a new vendor</option>
                                    {vendors.map((v) => <option key={v.id} value={v.business_id}>{v.business_id} — {v.name}</option>)}
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="poWarehouse">Stock warehouse (only for inventory)</label>
                                <select id="poWarehouse" value={warehouseBusinessId} onChange={(e) => setWarehouseBusinessId(e.target.value)}>
                                    <option value="">Select a warehouse…</option>
                                    {warehouses.map((w) => <option key={w.id} value={w.business_id}>{w.business_id} — {w.name}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="form-grid"><div className="field"><label>Approved requisition</label><select value={purchaseMeta.requisitionBusinessId} onChange={e=>{const r=(reqData?.requisitions||[]).find(x=>x.business_id===e.target.value);setPurchaseMeta({...purchaseMeta,requisitionBusinessId:e.target.value,destinationType:r?.destination_type||purchaseMeta.destinationType,destinationBusinessId:r?.destination_business_id||purchaseMeta.destinationBusinessId,destinationName:r?.destination_name||purchaseMeta.destinationName})}}><option value="">Emergency exception only</option>{(reqData?.requisitions||[]).filter(r=>r.status==='approved').map(r=><option key={r.id} value={r.business_id}>{r.business_id} — {r.title}</option>)}</select></div><div className="field"><label>Purchase type</label><select value={purchaseMeta.purchaseType} onChange={e=>setPurchaseMeta({...purchaseMeta,purchaseType:e.target.value})}>{['INVENTORY','RAW_MATERIAL','OFFICE_SUPPLY','MACHINERY','ELECTRICAL','IT_EQUIPMENT','FURNITURE','TOOL','SPARE_PART','MAINTENANCE','SAFETY','SERVICE','OTHER'].map(x=><option key={x}>{x}</option>)}</select></div><div className="field"><label>Receiving destination *</label><select required value={`${purchaseMeta.destinationType}|${purchaseMeta.destinationBusinessId}`} onChange={e=>{const [type,id]=e.target.value.split('|'),d=(destData?.destinations||[]).find(x=>x.type===type&&x.business_id===id);setPurchaseMeta({...purchaseMeta,destinationType:type,destinationBusinessId:id,destinationName:d?.name||''})}}><option value="|">Select receiver</option>{(destData?.destinations||[]).map((d,i)=><option key={`${d.type}-${d.business_id}-${i}`} value={`${d.type}|${d.business_id}`}>{d.type} — {d.name}</option>)}</select></div><label><input type="checkbox" checked={purchaseMeta.emergencyPurchase} onChange={e=>setPurchaseMeta({...purchaseMeta,emergencyPurchase:e.target.checked})}/> Authorized emergency purchase</label></div>{purchaseMeta.emergencyPurchase&&<div className="field"><label>Emergency authorization reason *</label><textarea required value={purchaseMeta.emergencyReason} onChange={e=>setPurchaseMeta({...purchaseMeta,emergencyReason:e.target.value})}/></div>}

                        <div className="field" style={{ marginTop: 6, overflowX: 'auto' }}>
                            <label>Line items *</label>
                            <p className="card-subtitle">Select an existing stock product, or leave it blank and describe any new item, machinery, equipment, office supply, service or other purchase.</p>
                            {lines.map((line, idx) => (
                                <div className="line-item-row" key={idx} style={{gridTemplateColumns:'1.3fr 1.5fr 1fr .65fr 1.2fr .6fr .8fr .8fr 32px',padding:'10px 0',borderBottom:'1px solid var(--line)',minWidth:1050}}>
                                    <select aria-label="Existing stock product" title="Existing stock product (optional)" value={line.productBusinessId} onChange={(e) => updateLine(idx, { productBusinessId: e.target.value, description: e.target.value ? '' : line.description })}>
                                        <option value="">Select product…</option>
                                        {products.map((p) => <option key={p.id} value={p.business_id}>{p.name}</option>)}
                                    </select>
                                    <input aria-label="New or non-stock item description" required={!line.productBusinessId} placeholder="New/non-stock item or service description" value={line.description} onChange={e=>updateLine(idx,{description:e.target.value,productBusinessId:e.target.value?'':line.productBusinessId})}/>
                                    <select aria-label="Item type" value={line.itemType} onChange={e=>updateLine(idx,{itemType:e.target.value})}>{['INVENTORY','RAW_MATERIAL','OFFICE_SUPPLY','MACHINERY','ELECTRICAL','IT_EQUIPMENT','FURNITURE','TOOL','SPARE_PART','MAINTENANCE','SAFETY','SERVICE','OTHER'].map(x=><option key={x}>{x}</option>)}</select>
                                    <input aria-label="Unit" required placeholder="Unit" value={line.unit} onChange={e=>updateLine(idx,{unit:e.target.value})}/>
                                    <select value={line.receivingAction} onChange={e=>updateLine(idx,{receivingAction:e.target.value})}><option value="STOCK">Add to stock</option><option value="ASSET">Create tagged asset</option><option value="CONSUMABLE">Department consumable</option><option value="DIRECT_USE">Direct use</option><option value="SERVICE">Service completion</option></select>
                                    <input aria-label="Quantity" required type="number" step="0.001" min="0.001" placeholder="Qty" value={line.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
                                    <input aria-label="Unit price" required type="number" step="0.01" min="0" placeholder="Unit price" value={line.unitPrice} onChange={(e) => updateLine(idx, { unitPrice: e.target.value })} />
                                    <span className="num" style={{ fontSize: 13 }}>৳{((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0)).toLocaleString()}</span>
                                    <button type="button" className="btn-ghost" onClick={() => removeLine(idx)} disabled={lines.length === 1}>✕</button>
                                </div>
                            ))}
                            <button type="button" className="btn btn-secondary btn-sm" onClick={addLine} style={{ marginTop: 4 }}><IconPlus /> Add line</button>
                        </div>

                        <div className="field" style={{ marginTop: 14, maxWidth: 200 }}>
                            <label htmlFor="poTax">Tax (৳)</label>
                            <input id="poTax" type="number" step="0.01" value={tax} onChange={(e) => setTax(e.target.value)} />
                        </div>

                        <div className="totals-box">
                            <div className="row"><span>Subtotal</span><span className="num">৳{subtotal.toLocaleString()}</span></div>
                            <div className="row"><span>Tax</span><span className="num">+ ৳{(Number(tax) || 0).toLocaleString()}</span></div>
                            <div className="row total"><span>Total</span><span className="num">৳{total.toLocaleString()}</span></div>
                        </div>

                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create purchase order'}</button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    );
}
