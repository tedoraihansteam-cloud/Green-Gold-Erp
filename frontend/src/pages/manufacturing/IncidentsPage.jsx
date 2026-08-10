import { useApi } from '../../lib/useApi';
import { api } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Pill from '../../components/Pill';
import BusinessIdentifier from '../../components/BusinessIdentifier';

const SEVERITY_COLOR = { low: 'var(--ink-600)', medium: 'var(--amber-600)', high: 'var(--rust-600)', critical: 'var(--rust-600)' };

export default function IncidentsPage() {
    const { can } = useAuth();
    const { data, loading, error, reload } = useApi('/manufacturing/incidents');
    const incidents = data?.incidents || [];

    const resolve = async (businessId) => {
        const notes = prompt('Resolution notes?') || '';
        try {
            await api.post(`/manufacturing/incidents/${businessId}/resolve`, { resolutionNotes: notes });
            reload();
        } catch (err) { alert(err.message); }
    };

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">Incidents</h1>
                    <p className="card-subtitle">Breakdowns and emergency alerts, machine-specific or general</p>
                </div>
            </div>

            <div className="card">
                {error && <div className="error-banner">{error}</div>}
                {loading ? <p style={{ color: 'var(--ink-600)' }}>Loading…</p> : (
                    <DataTable
                        columns={[
                            { key: 'business_id', label: 'ID', render: (r) => <BusinessIdentifier entityType="MACHINE_INCIDENT" businessId={r.business_id} /> },
                            { key: 'incident_type', label: 'Type', render: (r) => r.incident_type.replace(/_/g, ' ') },
                            { key: 'machine_name', label: 'Machine', render: (r) => r.machine_name || <span style={{ color: 'var(--ink-400)' }}>—</span> },
                            { key: 'severity', label: 'Severity', render: (r) => <span style={{ color: SEVERITY_COLOR[r.severity], fontWeight: 700, textTransform: 'capitalize' }}>{r.severity}</span> },
                            { key: 'description', label: 'Description' },
                            { key: 'status', label: 'Status', render: (r) => <Pill status={r.status} /> },
                            { key: 'actions', label: '', render: (r) => r.status !== 'resolved' && can('MANUFACTURING_APPROVE') && (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => resolve(r.business_id)}>Resolve</button>
                            )}
                        ]}
                        rows={incidents}
                        emptyMessage="No incidents reported."
                    />
                )}
            </div>
        </div>
    );
}
