import { Link, useParams } from 'react-router-dom';
import { useApi } from '../../lib/useApi';
import DataTable from '../../components/DataTable';
import { ReportDownloadActions } from '../../components/DocumentActions';

export default function AccountStatementPage() {
    const { businessId } = useParams();
    const { data, loading, error } = useApi(`/accounts/${businessId}/statement`);

    if (loading) return <p style={{ color: 'var(--ink-600)' }}>Loading…</p>;
    if (error) return <div className="error-banner">{error}</div>;
    if (!data) return null;

    return (
        <div>
            <Link to="/accounts" className="breadcrumb-link">← All accounts</Link>
            <div className="card-header" style={{ marginTop: 8, marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">{data.account.name}</h1>
                    <p className="card-subtitle mono">{data.account.business_id}</p>
                </div>
                <div className="stat-card" style={{ margin: 0 }}>
                    <div className="label">Current balance</div>
                    <div className="value">৳{Number(data.account.current_balance).toLocaleString()}</div>
                </div>
                <ReportDownloadActions basePath={`/documents/reports/account-statement/${businessId}`} name={`${businessId}-statement`} />
            </div>

            <div className="card">
                <div className="card-header"><h2>Recent transactions</h2></div>
                <DataTable
                    columns={[
                        { key: 'created_at', label: 'Date', render: (r) => new Date(r.created_at).toLocaleString() },
                        { key: 'transaction_type', label: 'Type', render: (r) => r.transaction_type.replace(/_/g, ' ') },
                        { key: 'reference_type', label: 'Reference', render: (r) => <span className="mono">{r.reference_type || '—'}{r.reference_id ? ` / ${r.reference_id}` : ''}</span> },
                        { key: 'amount', label: 'Amount', align: 'right', render: (r) => {
                            const out = ['WITHDRAWAL', 'TRANSFER_OUT'].includes(r.transaction_type);
                            return <span className="num" style={{ color: out ? 'var(--rust-600)' : 'var(--moss-600)' }}>{out ? '−' : '+'}৳{Number(r.amount).toLocaleString()}</span>;
                        }},
                        { key: 'balance_after', label: 'Balance after', align: 'right', render: (r) => <span className="num">৳{Number(r.balance_after).toLocaleString()}</span> }
                    ]}
                    rows={data.transactions}
                    emptyMessage="No transactions on this account yet."
                />
            </div>
        </div>
    );
}
