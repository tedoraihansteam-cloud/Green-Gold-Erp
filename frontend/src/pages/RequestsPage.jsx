import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/useApi';
import { api } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import Pill from '../components/Pill';

const EMPTY_FORM = {
    requestType: '',
    subject: '',
    body: '',
    amount: '',
    requestedDate: '',
    goodsDescription: '',
    expectedQuantity: '',
    quantityUnit: '',
    rentalDuration: '',
    reportMonth: '',
    reportScope: 'both',
    batchReference: '',
    deliveryQuantity: '',
    deliveryAddress: '',
    vehicleNumber: '',
    vehicleType: '',
    driverName: '',
    driverPhone: '',
};

function CustomerRequestFields({ form, update }) {
    if (form.requestType === 'PRE_RENTAL_BOOKING') {
        return (
            <>
                <div className="field">
                    <label htmlFor="requested-date">Preferred storage date *</label>
                    <input id="requested-date" type="date" required value={form.requestedDate} onChange={(event) => update('requestedDate', event.target.value)} />
                </div>
                <div className="field">
                    <label htmlFor="goods-description">Product / goods details</label>
                    <input id="goods-description" value={form.goodsDescription} onChange={(event) => update('goodsDescription', event.target.value)} placeholder="Product name, category or storage requirements" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                    <div className="field">
                        <label htmlFor="expected-quantity">Expected quantity</label>
                        <input id="expected-quantity" type="number" min="0" step="any" value={form.expectedQuantity} onChange={(event) => update('expectedQuantity', event.target.value)} />
                    </div>
                    <div className="field">
                        <label htmlFor="quantity-unit">Unit</label>
                        <input id="quantity-unit" value={form.quantityUnit} onChange={(event) => update('quantityUnit', event.target.value)} placeholder="kg, bag, carton" />
                    </div>
                </div>
                <div className="field">
                    <label htmlFor="rental-duration">Expected rental period</label>
                    <input id="rental-duration" value={form.rentalDuration} onChange={(event) => update('rentalDuration', event.target.value)} placeholder="For example, 3 months" />
                </div>
            </>
        );
    }

    if (form.requestType === 'MONTHLY_BILLING_STOCK_REPORT') {
        return (
            <>
                <div className="field">
                    <label htmlFor="report-month">Report month *</label>
                    <input id="report-month" type="month" required value={form.reportMonth} onChange={(event) => update('reportMonth', event.target.value)} />
                </div>
                <div className="field">
                    <label htmlFor="report-scope">Requested report *</label>
                    <select id="report-scope" required value={form.reportScope} onChange={(event) => update('reportScope', event.target.value)}>
                        <option value="both">Monthly billing and stock report</option>
                        <option value="billing">Monthly billing report only</option>
                        <option value="stock">Monthly stock report only</option>
                    </select>
                </div>
            </>
        );
    }

    if (form.requestType === 'DELIVERY_REQUEST') {
        return (
            <>
                <div className="field">
                    <label htmlFor="delivery-date">Requested delivery date *</label>
                    <input id="delivery-date" type="date" required value={form.requestedDate} onChange={(event) => update('requestedDate', event.target.value)} />
                </div>
                <div className="field">
                    <label htmlFor="batch-reference">Product, batch or document reference</label>
                    <input id="batch-reference" value={form.batchReference} onChange={(event) => update('batchReference', event.target.value)} />
                </div>
                <div className="field">
                    <label htmlFor="delivery-quantity">Quantity requested</label>
                    <input id="delivery-quantity" value={form.deliveryQuantity} onChange={(event) => update('deliveryQuantity', event.target.value)} placeholder="Quantity and unit" />
                </div>
                <div className="field">
                    <label htmlFor="delivery-address">Delivery address</label>
                    <textarea id="delivery-address" rows="2" value={form.deliveryAddress} onChange={(event) => update('deliveryAddress', event.target.value)} />
                </div>
                <p className="card-subtitle" style={{ margin: '14px 0 10px' }}>Vehicle and driver details are optional.</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="field">
                        <label htmlFor="vehicle-number">Vehicle number</label>
                        <input id="vehicle-number" value={form.vehicleNumber} onChange={(event) => update('vehicleNumber', event.target.value)} />
                    </div>
                    <div className="field">
                        <label htmlFor="vehicle-type">Vehicle type</label>
                        <input id="vehicle-type" value={form.vehicleType} onChange={(event) => update('vehicleType', event.target.value)} placeholder="Truck, pickup, van" />
                    </div>
                    <div className="field">
                        <label htmlFor="driver-name">Driver name</label>
                        <input id="driver-name" value={form.driverName} onChange={(event) => update('driverName', event.target.value)} />
                    </div>
                    <div className="field">
                        <label htmlFor="driver-phone">Driver phone</label>
                        <input id="driver-phone" type="tel" value={form.driverPhone} onChange={(event) => update('driverPhone', event.target.value)} />
                    </div>
                </div>
            </>
        );
    }

    return null;
}

function requestDetails(form) {
    if (form.requestType === 'PRE_RENTAL_BOOKING') {
        return {
            goodsDescription: form.goodsDescription,
            expectedQuantity: form.expectedQuantity || null,
            quantityUnit: form.quantityUnit,
            rentalDuration: form.rentalDuration,
        };
    }
    if (form.requestType === 'MONTHLY_BILLING_STOCK_REPORT') {
        return { reportMonth: form.reportMonth, reportScope: form.reportScope };
    }
    if (form.requestType === 'DELIVERY_REQUEST') {
        return {
            batchReference: form.batchReference,
            deliveryQuantity: form.deliveryQuantity,
            deliveryAddress: form.deliveryAddress,
            vehicleNumber: form.vehicleNumber,
            vehicleType: form.vehicleType,
            driverName: form.driverName,
            driverPhone: form.driverPhone,
        };
    }
    return {};
}

export default function RequestsPage() {
    const { user, can } = useAuth();
    const isCustomer = user?.account_type === 'customer';
    const { data, reload } = useApi('/requests');
    const { data: billData, reload: reloadBills } = useApi(isCustomer ? null : '/bills');
    const { data: payrollData } = useApi(!isCustomer && (can('HR_VIEW') || can('ACCOUNTS_VIEW')) ? '/hr/payroll-runs' : null);
    const {data:requisitionData}=useApi(isCustomer?null:'/procurement/requisitions');
    const {data:correctionData}=useApi(!isCustomer&&(can('USER_MANAGEMENT_VIEW')||can('USER_MANAGEMENT_EDIT'))?'/data-corrections':null);
    const { data: templateData } = useApi('/requests/templates');
    const [show, setShow] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

    function closeModal() {
        setShow(false);
        setForm(EMPTY_FORM);
        setError('');
    }

    function chooseType(requestType) {
        const template = (templateData?.templates || []).find((item) => item.code === requestType);
        setForm((current) => ({
            ...EMPTY_FORM,
            requestType,
            subject: template?.name || '',
            reportScope: current.reportScope || 'both',
        }));
    }

    async function submit(event) {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            await api.post('/requests', {
                requestType: form.requestType,
                subject: form.subject,
                body: form.body || undefined,
                amount: !isCustomer && form.amount ? Number(form.amount) : undefined,
                requestedDate: form.requestedDate || undefined,
                details: isCustomer ? requestDetails(form) : {},
                submit: true,
            });
            closeModal();
            reload();
            reloadBills?.();
        } catch (requestError) {
            setError(requestError.message || 'The request could not be submitted.');
        } finally {
            setSaving(false);
        }
    }

    async function review(id, decision) {
        const notes = decision === 'reject' ? window.prompt('Reason') || '' : '';
        await api.post(`/requests/${id}/review`, { decision, notes });
        reload();
    }

    const combinedRequests = [
        ...(data?.requests || []).map((row) => ({ ...row, record_kind: 'request' })),
        ...(!isCustomer ? (billData?.bills || []).map((bill) => ({
            ...bill,
            record_kind: 'bill',
            request_type: 'BILL / EXPENSE CLAIM',
            subject: `${bill.category} — ${bill.payee}`,
            department: 'ACCOUNTS',
            username: bill.submitter_name || bill.submitter_username,
            requested_date: bill.bill_date,
            can_review: false,
            created_at: bill.created_at,
        })) : []),
        ...((payrollData?.payrollRuns || []).map((run) => ({
            ...run,
            record_kind: 'payroll',
            request_type: 'PAYROLL PAY ORDER',
            subject: `${MONTH_NAME(run.period_month)} ${run.period_year} payroll — BDT ${Number(run.total_net_pay).toLocaleString('en-BD')}`,
            department: 'HR → ACCOUNTS',
            username: 'HR',
            requested_date: run.submitted_at || run.created_at,
            amount: run.total_net_pay,
            can_review: false,
        }))),
        ...((requisitionData?.requisitions||[]).map(r=>({...r,record_kind:'requisition',request_type:'PURCHASE REQUISITION',subject:r.title,department:'DEPARTMENT → PROCUREMENT',username:r.requester_name,requested_date:r.required_date,amount:r.estimated_total,can_review:false}))),
    ].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

    const columns = [
        { key: 'business_id', label: 'ID', render: (row) => row.record_kind === 'bill' ? <Link to={`/bills/${row.business_id}`}>{row.business_id}</Link> : row.record_kind === 'payroll' ? <Link to="/hr/payroll">{row.business_id}</Link> : row.record_kind==='requisition'?<Link to={`/procurement/requisitions/${row.business_id}`}>{row.business_id}</Link>:row.business_id },
        { key: 'request_type', label: 'Type' },
        { key: 'subject', label: 'Subject' },
        { key: 'department', label: 'Route', render: (row) => row.requires_accounts && row.department !== 'ACCOUNTS' ? `${row.department} → Accounts` : row.department },
        { key: 'requested_date', label: 'Requested date', render: (row) => row.requested_date ? new Date(row.requested_date).toLocaleDateString() : '—' },
        { key: 'username', label: 'Submitted by' },
        ...(!isCustomer ? [{ key: 'amount', label: 'Amount', render: (row) => row.amount ? `৳${Number(row.amount).toLocaleString()}` : '—' }] : []),
        { key: 'status', label: 'Status', render: (row) => <Pill status={row.status} /> },
        {
            key: 'actions',
            label: '',
            render: (row) => row.record_kind === 'bill' ? <Link className="btn btn-secondary btn-sm" to={`/bills/${row.business_id}`}>Open & review</Link> : row.record_kind === 'payroll' ? <Link className="btn btn-secondary btn-sm" to="/hr/payroll">Open pay order</Link> : row.record_kind==='requisition'?<Link className="btn btn-secondary btn-sm" to={`/procurement/requisitions/${row.business_id}`}>Open requisition</Link>:row.can_review ? (
                <div style={{ display: 'flex', gap: 5 }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => review(row.business_id, 'approve')}>Approve</button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => review(row.business_id, 'reject')}>Reject</button>
                </div>
            ) : null,
        },
    ];

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">{isCustomer ? 'My requests & outputs' : 'My letters, requests & bills'}</h1>
                    <p className="card-subtitle">
                        {isCustomer
                            ? 'Request advance storage, monthly billing or stock reports, and product delivery.'
                            : 'One place for every letter, departmental request, bill claim, review decision and final output.'}
                    </p>
                </div>
                <div style={{display:'flex',gap:7}}>{!isCustomer&&<Link className="btn btn-secondary" to="/procurement/requisitions">New purchase requisition</Link>}<button type="button" className="btn btn-primary" onClick={() => setShow(true)}>New request</button></div>
            </div>
            <div className="card"><DataTable rows={combinedRequests} columns={columns} emptyMessage="No letters, requests or bill claims yet." /></div>
            {show && (
                <Modal title={isCustomer ? 'Create customer request' : 'Prepare request or application'} onClose={closeModal}>
                    <form onSubmit={submit}>
                        <div className="field">
                            <label htmlFor="request-type">Request type *</label>
                            <select id="request-type" required value={form.requestType} onChange={(event) => chooseType(event.target.value)}>
                                <option value="">Select…</option>
                                {(templateData?.templates || []).map((template) => (
                                    <option key={template.code} value={template.code}>{template.name} → {template.department}</option>
                                ))}
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="request-subject">Subject *</label>
                            <input id="request-subject" required value={form.subject} onChange={(event) => update('subject', event.target.value)} />
                        </div>
                        {isCustomer && <CustomerRequestFields form={form} update={update} />}
                        <div className="field">
                            <label htmlFor="request-details">Additional details</label>
                            <textarea id="request-details" rows="5" value={form.body} onChange={(event) => update('body', event.target.value)} placeholder="Add instructions, references or other information…" />
                        </div>
                        {!isCustomer && (
                            <div className="field">
                                <label htmlFor="request-amount">Payment amount, if applicable (routes to Accounts)</label>
                                <input id="request-amount" type="number" step="0.01" value={form.amount} onChange={(event) => update('amount', event.target.value)} />
                            </div>
                        )}
                        {error && <div className="alert alert-danger" role="alert">{error}</div>}
                        <div className="form-actions">
                            <button className="btn btn-primary" disabled={saving}>{saving ? 'Submitting…' : 'Submit to department'}</button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    );
}

function MONTH_NAME(month) { return ['January','February','March','April','May','June','July','August','September','October','November','December'][Number(month)-1] || ''; }
