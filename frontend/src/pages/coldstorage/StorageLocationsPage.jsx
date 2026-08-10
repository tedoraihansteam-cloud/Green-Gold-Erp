import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api, downloadApiFile } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { IconPlus } from '../../components/Icons';
import BusinessIdentifier from '../../components/BusinessIdentifier';

const LOCATION_TYPES = ['FLOOR', 'ZONE', 'ROOM', 'RACK', 'SHELF', 'BIN'];

export default function StorageLocationsPage() {
    const { can } = useAuth();
    const { data, loading, error, reload } = useApi('/cold-storage/locations');
    const { data: whData } = useApi('/inventory/warehouses');
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ warehouseBusinessId: '', parentLocationBusinessId: '', locationType: 'ZONE', name: '', temperatureZone: '', capacityUnit: '', capacityValue: '' });
    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState([]);
    const [configuring, setConfiguring] = useState(null);
    const [categoryText, setCategoryText] = useState('');
    const [contents, setContents] = useState(null);

    const locations = data?.locations || [];
    const warehouses = whData?.warehouses || [];
    const toggle = (id) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    const saveCategories = async () => { try { await api.put(`/inventory/locations/${configuring.business_id}/categories`, { categories: categoryText.split(',').map((v) => v.trim()).filter(Boolean) }); setConfiguring(null); } catch (err) { setFormError(err.message); } };
    const viewContents = async (location) => { try { setContents(await api.get(`/inventory/locations/${location.business_id}/contents`)); } catch (err) { setFormError(err.message); } };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setBusy(true); setFormError('');
        try {
            await api.post('/cold-storage/locations', { ...form, capacityValue: form.capacityValue ? Number(form.capacityValue) : undefined });
            setShowForm(false);
            setForm({ warehouseBusinessId: '', parentLocationBusinessId: '', locationType: 'ZONE', name: '', temperatureZone: '', capacityUnit: '', capacityValue: '' });
            reload();
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">Storage locations</h1>
                    <p className="card-subtitle">Floor → zone → room → rack → shelf → bin, nested under a warehouse</p>
                </div>
                <div style={{display:'flex',gap:8}}><button type="button" className="btn btn-secondary" disabled={!selected.length} onClick={()=>downloadApiFile(`/documents/labels/locations.pdf?ids=${encodeURIComponent(selected.join(','))}`,'location-labels.pdf',true)}>Print labels ({selected.length})</button>{can('COLD_STORAGE_CREATE') && <button type="button" className="btn btn-primary" onClick={() => { setFormError(''); setShowForm(true); }}><IconPlus /> New location</button>}</div>
            </div>

            <div className="card">
                {error && <div className="error-banner">{error}</div>}
                {loading ? <p style={{ color: 'var(--ink-600)' }}>Loading…</p> : (
                    <DataTable
                        columns={[
                            {key:'select',label:'',render:r=><input type="checkbox" checked={selected.includes(r.business_id)} onChange={()=>toggle(r.business_id)}/>},
                            { key: 'business_id', label: 'ID', render: (r) => <BusinessIdentifier entityType="STORAGE_LOCATION" businessId={r.business_id}/> },
                            { key: 'location_type', label: 'Level' },
                            { key: 'name', label: 'Name' },
                            { key: 'parent_business_id', label: 'Inside', render: (r) => r.parent_business_id ? <span className="mono">{r.parent_business_id}</span> : <span style={{ color: 'var(--ink-400)' }}>{r.warehouse_business_id} (top level)</span> },
                            { key: 'temperature_zone', label: 'Temp. zone' },
                            {key:'actions',label:'',render:r=><div style={{display:'flex',gap:5}}><button className="btn btn-secondary btn-sm" onClick={()=>viewContents(r)}>Contents</button><button className="btn btn-secondary btn-sm" onClick={()=>{setConfiguring(r);setCategoryText('')}}>Categories</button></div>}
                        ]}
                        rows={locations}
                        emptyMessage="No storage locations yet — create your first zone or room under a warehouse."
                    />
                )}
            </div>

            {configuring&&<Modal title={`Allowed categories — ${configuring.name}`} onClose={()=>setConfiguring(null)}>{formError&&<div className="error-banner">{formError}</div>}<div className="field"><label>Product categories</label><input value={categoryText} onChange={e=>setCategoryText(e.target.value)} placeholder="potato, fruit, frozen food"/><div className="hint">Comma-separated. Leave empty to allow every category.</div></div><div className="form-actions"><button className="btn btn-secondary" onClick={()=>setConfiguring(null)}>Cancel</button><button className="btn btn-primary" onClick={saveCategories}>Save restrictions</button></div></Modal>}
            {contents&&<Modal title={`Contents — ${contents.location.name}`} onClose={()=>setContents(null)} wide><p className="card-subtitle">Allowed: {contents.allowedCategories.length?contents.allowedCategories.join(', '):'All categories'}</p><DataTable columns={[{key:'batch_business_id',label:'Batch',render:r=><BusinessIdentifier entityType="PRODUCT_BATCH" businessId={r.batch_business_id}/>},{key:'product_name',label:'Product'},{key:'category',label:'Category'},{key:'owner_customer_name',label:'Owner',render:r=>r.owner_customer_name||'Company'},{key:'quantity',label:'Quantity',render:r=>`${Number(r.quantity).toLocaleString()} ${r.unit}`}]} rows={contents.contents}/></Modal>}

            {showForm && (
                <Modal title="New storage location" onClose={() => setShowForm(false)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={handleSubmit}>
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="slWarehouse">Warehouse *</label>
                                <select id="slWarehouse" required value={form.warehouseBusinessId} onChange={(e) => setForm((s) => ({ ...s, warehouseBusinessId: e.target.value }))}>
                                    <option value="">Select…</option>
                                    {warehouses.map((w) => <option key={w.id} value={w.business_id}>{w.name}</option>)}
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="slParent">Inside (optional)</label>
                                <select id="slParent" value={form.parentLocationBusinessId} onChange={(e) => setForm((s) => ({ ...s, parentLocationBusinessId: e.target.value }))}>
                                    <option value="">Top level in warehouse</option>
                                    {locations.filter((l) => l.warehouse_business_id === form.warehouseBusinessId).map((l) => (
                                        <option key={l.id} value={l.business_id}>{l.location_type} — {l.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="slType">Level *</label>
                                <select id="slType" value={form.locationType} onChange={(e) => setForm((s) => ({ ...s, locationType: e.target.value }))}>
                                    {LOCATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="slName">Name *</label>
                                <input id="slName" required value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
                            </div>
                        </div>
                        <div className="field">
                            <label htmlFor="slTemp">Temperature zone</label>
                            <input id="slTemp" placeholder="e.g. -18C Frozen, 2-8C Chilled" value={form.temperatureZone} onChange={(e) => setForm((s) => ({ ...s, temperatureZone: e.target.value }))} />
                        </div>
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="slCapUnit">Capacity unit</label>
                                <input id="slCapUnit" placeholder="pallet, ton, cbm…" value={form.capacityUnit} onChange={(e) => setForm((s) => ({ ...s, capacityUnit: e.target.value }))} />
                            </div>
                            <div className="field">
                                <label htmlFor="slCapVal">Capacity value</label>
                                <input id="slCapVal" type="number" step="0.01" value={form.capacityValue} onChange={(e) => setForm((s) => ({ ...s, capacityValue: e.target.value }))} />
                            </div>
                        </div>
                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    );
}
