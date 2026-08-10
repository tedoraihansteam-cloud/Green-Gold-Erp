import { useMemo, useState } from 'react';
import { useApi } from '../../lib/useApi';
import DataTable from '../../components/DataTable';
import { ReportDownloadActions } from '../../components/DocumentActions';

const money = (value) => `৳${Number(value || 0).toLocaleString()}`;
const dateValue = (value) => value ? new Date(value).toLocaleString() : '—';

export default function BalanceSheetPage() {
    const [date, setDate] = useState(new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));
    const { data, loading, error } = useApi(`/accounts/balance-sheet?date=${date}`);
    const summary = data?.financialSummary || {};
    const activity = useMemo(() => {
        if (!data) return [];
        const rows = [
            ...(data.transactions || []).map((r, i) => ({ id: `TX-${i}-${r.created_at}`, date: r.created_at, type: r.transaction_type?.replaceAll('_', ' '), reference: [r.reference_type, r.reference_id].filter(Boolean).join(' '), party: '', description: r.notes, status: 'posted', account: r.account_name, received: ['DEPOSIT', 'TRANSFER_IN'].includes(r.transaction_type) ? r.amount : 0, expense: ['WITHDRAWAL', 'TRANSFER_OUT'].includes(r.transaction_type) ? r.amount : 0, outstanding: 0 })),
            ...(data.vouchers || []).map(r => ({ id: `V-${r.business_id}`, date: r.created_at, type: r.document_type?.replaceAll('_', ' '), reference: r.business_id, party: r.customer_name, description: [r.source_id, r.description].filter(Boolean).join(' — '), status: 'posted', account: r.account_name, received: r.document_type === 'MONEY_RECEIPT' ? r.amount : 0, expense: r.document_type !== 'MONEY_RECEIPT' ? r.amount : 0, outstanding: 0 })),
            ...(data.expenses || []).map(r => ({ id: `E-${r.business_id}`, date: r.expense_date, type: 'EXPENSE / DEDUCTION', reference: r.business_id, party: r.paid_to, description: [r.category, r.description].filter(Boolean).join(' — '), status: r.status, account: r.account_name, received: 0, expense: r.amount, outstanding: 0 })),
            ...(data.receivables || []).map((r, i) => ({ id: `R-${r.source_id}-${i}`, date: r.due_date, type: 'CUSTOMER DUE', reference: [r.source_type, r.source_id].filter(Boolean).join(' '), party: r.customer_name, description: r.description, status: r.status, account: '', received: r.paid_amount, expense: 0, outstanding: r.outstanding_amount })),
            ...(data.payables || []).map(r => ({ id: `P-${r.business_id}`, date: r.bill_date, type: ['approved', 'accounts_approved'].includes(r.status) ? 'APPROVED PAYABLE' : 'WAITING FOR APPROVAL', reference: r.business_id, party: r.payee, description: r.category, status: r.status, account: '', received: 0, expense: r.amount, outstanding: r.amount }))
        ];
        return rows.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    }, [data]);

    return <div>
        <div className="card-header" style={{ marginBottom: 18 }}>
            <div><h1 className="page-title">Balance sheet</h1><p className="card-subtitle">Account balances and one merged financial activity register for receipts, expenses, dues, payables and approvals.</p></div>
            <div className="field" style={{ margin: 0, width: 180 }}><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            <ReportDownloadActions basePath={`/documents/reports/balance-sheet?date=${date}`} name={`balance-sheet-${date}`} />
        </div>
        {error && <div className="error-banner">{error}</div>}
        {!loading && data && <>
            <div className="stat-grid">{[['Total cash', data.totals?.cash], ['Total bank', data.totals?.bank], ['Grand total', data.totals?.grandTotal], ['Daily received', summary.incoming], ['Daily expense / outgoing', summary.outgoing], ['Approved expenses', summary.expenses], ['Approved payables', summary.payables], ['Payroll', summary.payroll], ['Billed income', summary.billedIncome], ['Net cash movement', summary.netCashMovement]].map(([label, value]) => <div className="stat-card" key={label}><div className="label">{label}</div><div className="value">{money(value)}</div></div>)}</div>
            <div className="card"><div className="card-header"><h2>Account balances</h2></div><DataTable rows={data.accounts || []} keyField="business_id" columns={[{ key: 'business_id', label: 'ID' }, { key: 'name', label: 'Account' }, { key: 'account_type', label: 'Type' }, { key: 'balance', label: 'Balance', align: 'right', render: r => money(r.balance) }]} /></div>
            <div className="card"><div className="card-header"><div><h2>Financial transactions and pending actions</h2><p className="card-subtitle">Daily receipts, account movements, expenses, customer dues, approved payables and items waiting for approval in one register.</p></div></div><DataTable rows={activity} keyField="id" columns={[{ key: 'date', label: 'Date / time', render: r => dateValue(r.date) }, { key: 'type', label: 'Transaction type' }, { key: 'reference', label: 'Reference' }, { key: 'party', label: 'Customer / payee', render: r => r.party || '—' }, { key: 'description', label: 'Description / remarks', render: r => r.description || '—' }, { key: 'status', label: 'Status' }, { key: 'account', label: 'Account', render: r => r.account || '—' }, { key: 'received', label: 'Received', align: 'right', render: r => r.received ? money(r.received) : '—' }, { key: 'expense', label: 'Expense / payable', align: 'right', render: r => r.expense ? money(r.expense) : '—' }, { key: 'outstanding', label: 'Outstanding', align: 'right', render: r => r.outstanding ? money(r.outstanding) : '—' }]} /></div>
            <div className="card"><div className="card-header"><div><h2>Payroll position</h2><p className="card-subtitle">Payroll totals and employee counts by pay period.</p></div></div><DataTable rows={data.payroll || []} keyField="business_id" columns={[{ key: 'business_id', label: 'Payroll run' }, { key: 'period', label: 'Period', render: r => `${r.period_month}/${r.period_year}` }, { key: 'employee_count', label: 'Employees', align: 'right' }, { key: 'status', label: 'Status' }, { key: 'total_net_pay', label: 'Net payroll', align: 'right', render: r => money(r.total_net_pay) }]} /></div>
        </>}
        {loading && <div className="card"><p style={{ color: 'var(--ink-600)' }}>Loading…</p></div>}
    </div>;
}
