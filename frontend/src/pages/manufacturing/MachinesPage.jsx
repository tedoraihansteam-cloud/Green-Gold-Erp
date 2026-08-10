import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import Pill from '../../components/Pill';
import { IconPlus } from '../../components/Icons';
import BusinessIdentifier from '../../components/BusinessIdentifier';
import { BatchIdentifierDownload, ReportDownloadActions } from '../../components/DocumentActions';

const INCIDENT_TYPES = ['BREAKDOWN', 'POWER_FAILURE', 'TEMPERATURE_RISE', 'GENERATOR_FAILURE', 'COMPRESSOR_TRIP', 'LEAKAGE', 'FIRE', 'VIBRATION', 'DOOR_ALARM', 'OTHER'];

export default function MachinesPage() {
    const [searchParams] = useSearchParams();
    const { can } = useAuth();
    const { data, loading, error, reload } = useApi('/manufacturing/machines');
    const { data: whData } = useApi('/inventory/warehouses');
    const { data: logsData, loading: logsLoading, error: logsError, reload: reloadLogs } = useApi('/manufacturing/shift-logs');

    const [showCreate, setShowCreate] = useState(false);
    const [createForm, setCreateForm] = useState({ name: '', machineType: '', model: '', warehouseBusinessId: '' });

    const [shiftMachine, setShiftMachine] = useState(null);
    const [shiftForm, setShiftForm] = useState({ shiftType: 'morning', statusAtLog: 'running', runningHoursThisShift: '', handoverNotes: '' });

    const [incidentMachine, setIncidentMachine] = useState(null);
    const [incidentForm, setIncidentForm] = useState({ incidentType: 'BREAKDOWN', severity: 'medium', description: '' });

    const [formError, setFormError] = useState('');
    const [busy, setBusy] = useState(false);

    const machines = data?.machines || [];
    const warehouses = whData?.warehouses || [];
    const shiftLogs = logsData?.shiftLogs || [];

    useEffect(() => {
        const target = machines.find((machine) => machine.business_id === searchParams.get('machine'));
        if (!target) return;
        if (searchParams.get('action') === 'shift') setShiftMachine(target);
        if (searchParams.get('action') === 'incident') setIncidentMachine(target);
    }, [machines, searchParams]);

    const handleCreate = async (e) => {
        e.preventDefault();
        setBusy(true); setFormError('');
        try {
            await api.post('/manufacturing/machines', createForm);
            setShowCreate(false);
            setCreateForm({ name: '', machineType: '', model: '', warehouseBusinessId: '' });
            reload();
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    const submitShift = async (e) => {
        e.preventDefault();
        setBusy(true); setFormError('');
        try {
            await api.post('/manufacturing/shift-logs', { ...shiftForm, machineBusinessId: shiftMachine.business_id });
            setShiftMachine(null);
            setShiftForm({ shiftType: 'morning', statusAtLog: 'running', runningHoursThisShift: '', handoverNotes: '' });
            reload(); reloadLogs();
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    const submitIncident = async (e) => {
        e.preventDefault();
        setBusy(true); setFormError('');
        try {
            await api.post('/manufacturing/incidents', { ...incidentForm, machineBusinessId: incidentMachine.business_id });
            setIncidentMachine(null);
            setIncidentForm({ incidentType: 'BREAKDOWN', severity: 'medium', description: '' });
            reload();
        } catch (err) { setFormError(err.message); } finally { setBusy(false); }
    };

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">Machines</h1>
                    <p className="card-subtitle">24/7 machine room — running hours, shift handover, and breakdown reporting</p>
                </div>
                {can('MANUFACTURING_CREATE') && <button type="button" className="btn btn-primary" onClick={() => { setFormError(''); setShowCreate(true); }}><IconPlus /> New machine</button>}
                <BatchIdentifierDownload entityType="MACHINE" rows={machines} />
            </div>

            <div className="card">
                {error && <div className="error-banner">{error}</div>}
                {loading ? <p style={{ color: 'var(--ink-600)' }}>Loading…</p> : (
                    <DataTable
                        columns={[
                            { key: 'business_id', label: 'ID', render: (r) => <BusinessIdentifier entityType="MACHINE" businessId={r.business_id} /> },
                            { key: 'name', label: 'Name' },
                            { key: 'machine_type', label: 'Type' },
                            { key: 'warehouse_name', label: 'Location' },
                            { key: 'total_running_hours', label: 'Total hours', align: 'right', render: (r) => <span className="num">{Number(r.total_running_hours).toLocaleString()}</span> },
                            { key: 'status', label: 'Status', render: (r) => <Pill status={r.status} /> },
                            { key: 'actions', label: '', render: (r) => (
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <Link className="btn btn-secondary btn-sm" to={`/manufacturing/machines/${r.business_id}/history`}>2-year history</Link>
                                    {can('MANUFACTURING_CREATE')&&<><button type="button" className="btn btn-secondary btn-sm" onClick={() => setShiftMachine(r)}>Log shift</button>
                                    <button type="button" className="btn btn-danger btn-sm" onClick={() => setIncidentMachine(r)}>Report issue</button></>}
                                </div>
                            )}
                        ]}
                        rows={machines}
                        emptyMessage="No machines registered yet."
                    />
                )}
            </div>

            <div className="card">
                <div className="card-header"><div><h2>Machine shift logs</h2><p className="card-subtitle">Inspection, running hours and handover history</p></div><ReportDownloadActions basePath="/documents/reports/machine-logs" name="machine-shift-logs" /></div>
                {logsError && <div className="error-banner">{logsError}</div>}
                {logsLoading ? <p>Loading…</p> : <DataTable columns={[
                    { key: 'machine_business_id', label: 'Machine', render: (r) => <span className="mono">{r.machine_business_id}</span> },
                    { key: 'shift_date', label: 'Date', render: (r) => new Date(r.shift_date).toLocaleDateString() },
                    { key: 'shift_type', label: 'Shift' }, { key: 'status_at_log', label: 'Status', render: (r) => <Pill status={r.status_at_log} /> },
                    { key: 'running_hours_this_shift', label: 'Hours', align: 'right' }, { key: 'handover_notes', label: 'Handover notes' },
                    { key: 'logged_by_username', label: 'Logged by' }
                ]} rows={shiftLogs} keyField="id" emptyMessage="No machine shift logs yet." />}
            </div>

            {showCreate && (
                <Modal title="New machine" onClose={() => setShowCreate(false)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={handleCreate}>
                        <div className="field"><label htmlFor="mName">Name *</label><input id="mName" required value={createForm.name} onChange={(e) => setCreateForm((s) => ({ ...s, name: e.target.value }))} /></div>
                        <div className="form-grid">
                            <div className="field"><label htmlFor="mType">Type</label><input id="mType" placeholder="compressor, generator, boiler…" value={createForm.machineType} onChange={(e) => setCreateForm((s) => ({ ...s, machineType: e.target.value }))} /></div>
                            <div className="field"><label htmlFor="mModel">Model</label><input id="mModel" value={createForm.model} onChange={(e) => setCreateForm((s) => ({ ...s, model: e.target.value }))} /></div>
                        </div>
                        <div className="field">
                            <label htmlFor="mWarehouse">Location</label>
                            <select id="mWarehouse" value={createForm.warehouseBusinessId} onChange={(e) => setCreateForm((s) => ({ ...s, warehouseBusinessId: e.target.value }))}>
                                <option value="">Select…</option>
                                {warehouses.map((w) => <option key={w.id} value={w.business_id}>{w.name}</option>)}
                            </select>
                        </div>
                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
                        </div>
                    </form>
                </Modal>
            )}

            {shiftMachine && (
                <Modal title={`Log shift — ${shiftMachine.name}`} onClose={() => setShiftMachine(null)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={submitShift}>
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="sType">Shift</label>
                                <select id="sType" value={shiftForm.shiftType} onChange={(e) => setShiftForm((s) => ({ ...s, shiftType: e.target.value }))}>
                                    <option value="morning">Morning</option><option value="evening">Evening</option><option value="night">Night</option>
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="sStatus">Status</label>
                                <select id="sStatus" value={shiftForm.statusAtLog} onChange={(e) => setShiftForm((s) => ({ ...s, statusAtLog: e.target.value }))}>
                                    <option value="running">Running</option><option value="stopped">Stopped</option><option value="idle">Idle</option>
                                </select>
                            </div>
                        </div>
                        <div className="field"><label htmlFor="sHours">Running hours this shift</label><input id="sHours" type="number" step="0.1" value={shiftForm.runningHoursThisShift} onChange={(e) => setShiftForm((s) => ({ ...s, runningHoursThisShift: e.target.value }))} /></div>
                        <div className="field"><label htmlFor="sNotes">Handover notes</label><textarea id="sNotes" rows={2} value={shiftForm.handoverNotes} onChange={(e) => setShiftForm((s) => ({ ...s, handoverNotes: e.target.value }))} /></div>
                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShiftMachine(null)}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Log shift'}</button>
                        </div>
                    </form>
                </Modal>
            )}

            {incidentMachine && (
                <Modal title={`Report issue — ${incidentMachine.name}`} onClose={() => setIncidentMachine(null)}>
                    {formError && <div className="error-banner">{formError}</div>}
                    <form onSubmit={submitIncident}>
                        <div className="form-grid">
                            <div className="field">
                                <label htmlFor="iType">Type</label>
                                <select id="iType" value={incidentForm.incidentType} onChange={(e) => setIncidentForm((s) => ({ ...s, incidentType: e.target.value }))}>
                                    {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                                </select>
                            </div>
                            <div className="field">
                                <label htmlFor="iSeverity">Severity</label>
                                <select id="iSeverity" value={incidentForm.severity} onChange={(e) => setIncidentForm((s) => ({ ...s, severity: e.target.value }))}>
                                    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
                                </select>
                            </div>
                        </div>
                        <div className="field"><label htmlFor="iDesc">Description *</label><textarea id="iDesc" rows={3} required value={incidentForm.description} onChange={(e) => setIncidentForm((s) => ({ ...s, description: e.target.value }))} /></div>
                        <div className="form-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setIncidentMachine(null)}>Cancel</button>
                            <button type="submit" className="btn btn-danger" disabled={busy}>{busy ? 'Reporting…' : 'Report issue'}</button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    );
}
