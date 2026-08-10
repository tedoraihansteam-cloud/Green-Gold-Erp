import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';

const emptyForm = () => ({
  siteId: '', name: '', code: '', description: '', headEmployeeId: '', costCenterId: '',
  status: 'active', operationalSettings: { canReceivePurchases: true, requiresDailyReport: false }
});

export default function DepartmentsPage() {
  const { can } = useAuth();
  const { data, reload } = useApi('/org/departments');
  const { data: siteData } = useApi('/org/sites');
  const { data: employeeData } = useApi('/employees');
  const { data: costData } = useApi('/financial-controls/cost-centers');
  const [show, setShow] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [staffIds, setStaffIds] = useState([]);
  const [error, setError] = useState('');
  const { data: detail, reload: reloadDetail } = useApi(selected ? `/org/departments/${selected}` : null);

  const save = async (event) => {
    event.preventDefault();
    try {
      setError('');
      await api.post('/org/departments', form);
      setShow(false);
      reload();
    } catch (err) { setError(err.message); }
  };
  const assign = async () => {
    try {
      await api.post(`/org/departments/${selected}/assign-staff`, { employeeBusinessIds: staffIds });
      setStaffIds([]); reloadDetail(); reload();
    } catch (err) { alert(err.message); }
  };
  const siteLabel = (site) => `${String(site.site_type || 'location').replaceAll('_', ' ')} — ${site.name}${site.address ? ` — ${site.address}` : ''}`;

  return <div>
    <div className="card-header"><div><h1 className="page-title">Department management</h1><p className="card-subtitle">Departments use office, factory, cold-store and other locations configured in Application Settings.</p></div>{can('SETTINGS_CREATE') && <button className="btn btn-primary" onClick={() => { setForm(emptyForm()); setError(''); setShow(true); }}>New department</button>}</div>
    <div className="card"><DataTable rows={data?.departments || []} emptyMessage="No departments configured." columns={[
      { key: 'business_id', label: 'Department ID' }, { key: 'code', label: 'Code' }, { key: 'name', label: 'Department' },
      { key: 'site_name', label: 'Location', render: r => r.site_name ? `${r.site_name}${r.site_address ? ` — ${r.site_address}` : ''}` : 'Not assigned' },
      { key: 'head_name', label: 'Head', render: r => r.head_name || 'Not assigned' }, { key: 'cost_center_name', label: 'Cost center', render: r => r.cost_center_name || 'Not assigned' },
      { key: 'staff_count', label: 'Staff' }, { key: 'status', label: 'Status' }, { key: 'actions', label: '', render: r => <button className="btn btn-secondary btn-sm" onClick={() => setSelected(r.business_id)}>Open</button> }
    ]}/></div>
    {show && <Modal title="Create department" onClose={() => setShow(false)} wide>{error && <div className="error-banner">{error}</div>}<form onSubmit={save}>
      <div className="form-grid">
        <div className="field"><label>Configured location *</label><select required value={form.siteId} onChange={e => setForm({ ...form, siteId: e.target.value })}><option value="">Select an Application Settings location</option>{(siteData?.sites || []).map(site => <option key={site.id} value={site.id}>{siteLabel(site)}</option>)}</select></div>
        <div className="field"><label>Department name *</label><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></div>
        <div className="field"><label>Code *</label><input required placeholder="Example: MFG" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })}/></div>
        <div className="field"><label>Department head</label><select value={form.headEmployeeId} onChange={e => setForm({ ...form, headEmployeeId: e.target.value })}><option value="">Assign later</option>{(employeeData?.employees || []).map(x => <option key={x.id} value={x.id}>{x.full_name}</option>)}</select></div>
        <div className="field"><label>Cost center</label><select value={form.costCenterId} onChange={e => setForm({ ...form, costCenterId: e.target.value })}><option value="">No cost center</option>{(costData?.costCenters || []).map(x => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</select></div>
      </div>
      <div className="field"><label>Purpose and responsibilities</label><textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></div>
      <div style={{ display: 'flex', gap: 18 }}><label><input type="checkbox" checked={form.operationalSettings.canReceivePurchases} onChange={e => setForm({ ...form, operationalSettings: { ...form.operationalSettings, canReceivePurchases: e.target.checked } })}/> Can receive purchases</label><label><input type="checkbox" checked={form.operationalSettings.requiresDailyReport} onChange={e => setForm({ ...form, operationalSettings: { ...form.operationalSettings, requiresDailyReport: e.target.checked } })}/> Daily report mandatory</label></div>
      <div className="form-actions"><button className="btn btn-primary">Create department</button></div>
    </form></Modal>}
    {selected && detail?.department && <Modal title={`${detail.department.code} — ${detail.department.name}`} onClose={() => setSelected(null)} wide>
      <div className="stat-grid"><div className="stat-card"><div className="label">Location</div><div className="value">{detail.department.site_name || 'Not assigned'}</div><small>{detail.department.site_type || ''}{detail.department.site_address ? ` — ${detail.department.site_address}` : ''}</small></div><div className="stat-card"><div className="label">Head</div><div className="value">{detail.department.head_name || 'Not assigned'}</div></div><div className="stat-card"><div className="label">Cost center</div><div className="value">{detail.department.cost_center_name || 'Not assigned'}</div></div></div>
      <p>{detail.department.description || 'No responsibility description.'}</p><h3>Assigned staff</h3><DataTable rows={detail.department.staff || []} emptyMessage="No staff assigned." columns={[{ key: 'business_id', label: 'Employee' }, { key: 'full_name', label: 'Name' }, { key: 'designation', label: 'Designation' }, { key: 'status', label: 'Status' }]}/>
      {can('HR_EDIT') && <div className="card"><h3>Assign staff</h3><select multiple size="6" value={staffIds} onChange={e => setStaffIds([...e.target.selectedOptions].map(x => x.value))}>{(employeeData?.employees || []).map(x => <option key={x.id} value={x.business_id}>{x.full_name} — {x.designation || 'Staff'}</option>)}</select><button className="btn btn-primary" onClick={assign}>Assign selected staff</button></div>}
      <h3>Workflow responsibilities</h3><DataTable rows={detail.department.workflows || []} emptyMessage="No workflow explicitly assigned." columns={[{ key: 'workflow_key', label: 'Workflow' }, { key: 'display_name', label: 'Name' }, { key: 'enabled', label: 'Status', render: r => r.enabled ? 'Enabled' : 'Disabled' }]}/>
    </Modal>}
  </div>;
}
