import { useState } from 'react';
import { api, downloadApiFile } from '../../lib/apiClient';
import { useApi } from '../../lib/useApi';
import StructuredReviewEditor from './StructuredReviewEditor';
import MultiDomainReview from './MultiDomainReview';

const money = (value) => `৳${Number(value || 0).toLocaleString()}`;
const reviewExtractionPayload = (extraction) => ({
    ...extraction,
    sections: (extraction?.sections || []).map(({ sourceSnapshot, manualReview, ...section }) => section)
});

export default function UniversalBulkImport() {
    const { data, reload } = useApi('/bulk-imports');
    const [referenceQuery,setReferenceQuery]=useState('');
    const {data:referenceData}=useApi(`/bulk-imports/reference-register${referenceQuery?`?q=${encodeURIComponent(referenceQuery)}`:''}`);
    const [type, setType] = useState('auto');
    const [file, setFile] = useState(null);
    const [active, setActive] = useState(null);
    const [mapping, setMapping] = useState({});
    const [options, setOptions] = useState({});
    const [extractionDraft, setExtractionDraft] = useState(null);
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [approvalNotes, setApprovalNotes] = useState('');

    const loadReview = (job) => {
        setActive(job);
        setMapping(job.field_mapping || {});
        setExtractionDraft(job.extraction_result || null);
        const saved = job.submission_options || {}, review = job.review_context || {};
        setOptions({
            ...saved,
            customerBusinessId: saved.customerBusinessId || review.suggestedCustomerBusinessId || '',
            warehouseBusinessId: saved.warehouseBusinessId || review.suggestedWarehouseBusinessId || '',
            locationBusinessId: saved.locationBusinessId || review.suggestedLocationBusinessId || '',
            accountBusinessId: saved.accountBusinessId || review.suggestedAccountBusinessId || ''
        });
    };
    async function upload() {
        if (!file) return setMessage('Select a file first');
        const form = new FormData(); form.append('importType', type); form.append('file', file);
        setBusy(true);
        try { const result = await api.postForm('/bulk-imports', form); loadReview(result.job); setMessage('Document detected and extracted. Review every section before final submission.'); reload(); }
        catch (error) { setMessage(error.message); }
        finally { setBusy(false); }
    }
    async function submit() {
        setBusy(true);
        try {
            await api.put(`/bulk-imports/${active.business_id}/mapping`, { fieldMapping: mapping, submissionOptions: options, extractionResult: structured || multiDomain ? (multiDomain ? reviewExtractionPayload(extractionDraft) : extractionDraft) : undefined });
            if (multiDomain) {
                const approval = await api.post(`/bulk-imports/${active.business_id}/approval/submit`, { notes: approvalNotes });
                loadReview(approval.job); setApprovalNotes(''); setMessage(approval.message); reload(); return;
            }
            const result = await api.post(`/bulk-imports/${active.business_id}/submit`, {});
            setMessage(`${result.imported} approved records and units were routed successfully. Customer, stock, charges, dues, payments, receipts, and identities are synchronized.`);
            setActive(null); reload();
        } catch (error) {
            setMessage(error.message);
            try { const refreshed = await api.get(`/bulk-imports/${active.business_id}`); loadReview(refreshed.job); } catch { /* keep the current review */ }
        } finally { setBusy(false); }
    }
    async function decideApproval(decision) {
        if (!approvalNotes.trim()) return setMessage('Remarks are required for every approval decision.');
        setBusy(true);
        try { const result = await api.post(`/bulk-imports/${active.business_id}/approval/decision`, { decision, notes: approvalNotes }); loadReview(result.job); setApprovalNotes(''); setMessage(result.message); reload(); }
        catch (error) { setMessage(error.message); }
        finally { setBusy(false); }
    }
    async function postResults() {
        setBusy(true);
        try { const result = await api.post(`/bulk-imports/${active.business_id}/post-results`, {}); loadReview(result.job); setMessage(result.message); reload(); }
        catch (error) { setMessage(error.message); }
        finally { setBusy(false); }
    }
    async function saveReview() {
        setBusy(true);
        try { const result = await api.put(`/bulk-imports/${active.business_id}/mapping`, { fieldMapping: mapping, submissionOptions: options, extractionResult: structured || multiDomain ? (multiDomain ? reviewExtractionPayload(extractionDraft) : extractionDraft) : undefined }); loadReview(result.job); setMessage(active.final_approved_at ? 'Posting destinations saved. You can retry the failed operational sections now.' : multiDomain ? 'Multi-department extraction review saved safely. No operational ERP data was posted.' : 'Edited review saved and all stock, charge, payment, and due totals were recalculated.'); reload(); }
        catch (error) { setMessage(error.message); }
        finally { setBusy(false); }
    }
    async function openJob(businessId) { try { const result = await api.get(`/bulk-imports/${businessId}`); loadReview(result.job); setMessage('Review job loaded'); } catch (error) { setMessage(error.message); } }
    async function removeActive() { if (!active || !window.confirm(`Remove review upload ${active.business_id}?`)) return; try { await api.del(`/bulk-imports/${active.business_id}`); setActive(null); setMessage('Review upload removed'); reload(); } catch (error) { setMessage(error.message); } }

    const rows = active?.preview_rows || [];
    const columns = active?.detected_columns || [];
    const extraction = extractionDraft || active?.extraction_result || {};
    const structured = extraction.mode === 'structured';
    const multiDomain = extraction.mode === 'multi_domain';
    const context = active?.review_context || {};
    const summary = active?.source_summary || {};
    const legacyApprovedPendingPosting = Boolean(multiDomain && active?.status === 'submitted' && (extraction.sections || []).some((item) => item.selected && item.postingIntent === 'operational'));

    return <section className="card">
        <h2>Universal data upload and automation</h2>
        <p className="hint">Upload → extract → preserve as a searchable reference → layered approval. Live ERP records change only when an approved section is explicitly marked for operational posting.</p>
        <details className="card" style={{padding:14,marginBottom:14}}><summary><strong>Reference register</strong> · historical and staged source rows</summary><div className="field" style={{marginTop:12}}><label>Search reference data</label><input value={referenceQuery} onChange={event=>setReferenceQuery(event.target.value)} placeholder="Customer, product, voucher, workbook or amount"/></div><div style={{overflow:'auto',maxHeight:480}}><table className="data"><thead><tr><th>Import</th><th>Workbook / sheet</th><th>Source</th><th>Classification</th><th>Date</th><th>Extracted data</th></tr></thead><tbody>{(referenceData?.rows||[]).map(row=><tr key={row.id}><td>{row.import_business_id}</td><td>{row.original_name}<div className="hint">{row.sheet_name}</div></td><td>{row.source_row}</td><td>{String(row.disposition).replaceAll('_',' ')}</td><td>{row.effective_date||'—'}</td><td><pre style={{whiteSpace:'pre-wrap',maxWidth:500}}>{JSON.stringify(row.record_data,null,2)}</pre></td></tr>)}</tbody></table></div></details>
        <div className="form-grid">
            <div className="field"><label>Document type</label><select value={type} onChange={(event) => setType(event.target.value)}><option value="auto">Auto-detect all departments and data</option><option value="payroll">Payroll / HR / attendance</option><option value="accounts">Accounts and transactions</option><option value="stock_report">Customer stock, rental, payment or due report</option><option value="raw_material_report">Raw-material receiving workbook</option><option value="document">Business Word document</option><option value="staff">Staff master data</option><option value="customer">Customer list</option><option value="product">Product list</option><option value="vendor">Vendor or supplier list</option></select></div>
            <div className="field"><label>Data file</label><input type="file" accept=".csv,.json,.xlsx,.xls,.xlsm,.docx" onChange={(event) => setFile(event.target.files?.[0])} /></div>
        </div>
        <div className="form-actions">{['customer', 'product', 'vendor'].includes(type) && <button className="btn btn-secondary" onClick={() => downloadApiFile(`/bulk-imports/template/${type}`, `${type}-bulk-upload-template.csv`)}>Download optional template</button>}<button className="btn btn-primary" disabled={busy} onClick={upload}>{busy ? 'Reading document…' : 'Upload, read and review'}</button></div>
        {message && <div className={/successfully|detected|synchronized|loaded|removed|saved|recalculated/i.test(message) ? 'success-banner' : 'error-banner'}>{message}</div>}

        {active && <div style={{ marginTop: 18 }}>
            <div className="card-header"><div><h3>Review {active.original_name}</h3><p className="card-subtitle">Detected as <strong>{String(active.detected_document_type || active.import_type).replace(/_/g, ' ')}</strong> · {active.business_id}</p></div><span className="pill">{active.status}</span></div>
            {(active.validation_errors || []).length > 0 && <div className="error-banner"><strong>Validation requires attention</strong>{active.validation_errors.slice(0, 12).map((error, index) => <div key={index}>{error.row ? `Row ${error.row}: ` : ''}{error.field} - {error.message}</div>)}</div>}

            {multiDomain ? <MultiDomainReview extraction={extraction} setExtraction={setExtractionDraft} context={context} /> : structured ? <>
                <StructuredReviewEditor extraction={extraction} setExtraction={setExtractionDraft} context={context} options={options} setOptions={setOptions} />
                <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', margin: '14px 0' }}>
                    {[['Received', `${Number(summary.receivedLots || 0).toLocaleString()} units`], ['Delivered', `${Number(summary.deliveredLots || 0).toLocaleString()} units`], ['In stock', `${Number(summary.inStockLots || 0).toLocaleString()} units`], ...(summary.totalKg ? [['Weight', `${Number(summary.totalKg).toLocaleString()} kg`]] : []), ['Total charged', money(summary.totalCharged)], ['Payments', money(summary.paymentsReceived)], ['Due', money(summary.totalDue)]].map(([label, value]) => <div className="stat-card" key={label}><div className="label">{label}</div><div className="value" style={{ fontSize: 20 }}>{value}</div></div>)}
                </div>

                <div className="card" style={{ padding: 14 }}><h3>DETECTED CUSTOMER</h3><strong>{extraction.customer?.name}</strong><div>{extraction.customer?.contactName && `${extraction.customer.contactName} · `}{extraction.customer?.phone}</div><div className="hint">{extraction.customer?.address}</div></div>

                <h3>RECONCILIATION</h3>
                <div style={{ overflowX: 'auto' }}><table className="data"><thead><tr><th>Check</th><th>Workbook</th><th>Calculated</th><th>Difference</th><th>Status</th></tr></thead><tbody>{(extraction.reconciliation || []).map((check) => <tr key={check.key}><td>{check.label}</td><td>{Number(check.reported).toLocaleString()}</td><td>{Number(check.calculated).toLocaleString()}</td><td>{Number(check.difference).toLocaleString()}</td><td><span className={`pill ${check.status === 'matched' ? 'pill-success' : 'pill-danger'}`}>{check.status}</span></td></tr>)}</tbody></table></div>

                <h3>DEPARTMENT ROUTING</h3>
                <div className="form-grid">{(active.routing_plan || []).map((route, index) => <div className="card" style={{ padding: 12 }} key={`${route.recordType}-${index}`}><strong>{route.department}</strong><div>{route.count} {String(route.recordType).replace(/_/g, ' ')}</div><div className="hint">{route.action}</div></div>)}</div>

                <h3>POSTING DESTINATIONS</h3>
                <p className="hint">The workbook does not contain internal portal IDs for the warehouse, storage location, or receiving account. Select them before approval; extracted figures remain unchanged.</p>
                <div className="form-grid">
                    <div className="field"><label>Customer match</label><select value={options.customerBusinessId || ''} onChange={(event) => setOptions((value) => ({ ...value, customerBusinessId: event.target.value }))}><option value="">Create detected customer if no exact match</option>{(context.customers || []).map((row) => <option value={row.business_id} key={row.business_id}>{row.business_id} · {row.name}</option>)}</select></div>
                    <div className="field"><label>Receiving warehouse</label><select value={options.warehouseBusinessId || ''} onChange={(event) => setOptions((value) => ({ ...value, warehouseBusinessId: event.target.value, locationBusinessId: '' }))}><option value="">Select warehouse</option>{(context.warehouses || []).map((row) => <option value={row.business_id} key={row.business_id}>{row.business_id} · {row.name}</option>)}</select></div>
                    <div className="field"><label>Storage location (recommended)</label><select value={options.locationBusinessId || ''} onChange={(event) => { const selected = (context.locations || []).find((row) => row.business_id === event.target.value); setOptions((value) => ({ ...value, locationBusinessId: event.target.value, warehouseBusinessId: selected?.warehouse_business_id || value.warehouseBusinessId })); }}><option value="">Receive without assigning a location</option>{(context.locations || []).filter((row) => !options.warehouseBusinessId || row.warehouse_business_id === options.warehouseBusinessId).map((row) => <option value={row.business_id} key={row.business_id}>{row.warehouse_name} · {row.location_type} · {row.name}</option>)}</select></div>
                    <div className="field"><label>Payment receiving account</label><select value={options.accountBusinessId || ''} onChange={(event) => setOptions((value) => ({ ...value, accountBusinessId: event.target.value }))}><option value="">Select cash or bank account</option>{(context.accounts || []).map((row) => <option value={row.business_id} key={row.business_id}>{row.business_id} · {row.name} · {row.account_type}</option>)}</select></div>
                </div>

                <h3>GOODS RECEIPTS AND STOCK</h3>
                <div style={{ overflowX: 'auto' }}><table className="data"><thead><tr><th>Reference</th><th>Date</th><th>Product</th><th>Units</th><th>Type</th><th>Kg/unit</th><th>Vehicle</th><th>Delivered</th><th>Remaining</th><th>Rent</th><th>Labor</th><th>Source sheet</th></tr></thead><tbody>{(extraction.goodsReceipts || []).map((row) => <tr key={row.externalReference}><td className="mono">{row.externalReference}</td><td>{row.receivedDate}</td><td>{row.productName}{row.rawProductName !== row.productName && <div className="hint">Source: {row.rawProductName}</div>}</td><td>{row.totalLots}</td><td>{row.unit || 'lot'}</td><td>{row.kgPerLot}</td><td>{row.vehicleNumber || '-'}</td><td>{row.deliveredQuantity}</td><td>{row.remainingQuantity}</td><td>{money(row.rentAmount)}</td><td>{money(row.laborAmount)}</td><td>{row.sourceSheet || extraction.sheetName}</td></tr>)}</tbody></table></div>

                <h3>PAYMENTS</h3>
                <div style={{ overflowX: 'auto' }}><table className="data"><thead><tr><th>Date</th><th>Reference</th><th>Amount</th><th>Rent part</th><th>Labor part</th></tr></thead><tbody>{(extraction.payments || []).map((row, index) => <tr key={`${row.reference}-${index}`}><td>{row.paymentDate}</td><td>{row.reference || '-'}</td><td>{money(row.amount)}</td><td>{money(row.rentAmount)}</td><td>{money(row.laborAmount)}</td></tr>)}</tbody></table></div>
            </> : <>
                {active.import_type === 'customer' && context.customerMatches && <div className="success-banner">Customer detection: {context.registeredCount} already registered and will be reused · {context.newCount} new customers will be created after approval.</div>}
                <div className="form-grid">{Object.keys(mapping).map((target) => <div className="field" key={target}><label>{target}{target === 'name' ? ' *' : ''}</label><select value={mapping[target] || ''} onChange={(event) => setMapping((value) => ({ ...value, [target]: event.target.value }))}><option value="">Do not import</option>{columns.map((column) => <option value={column} key={column}>{column}</option>)}</select></div>)}</div>
                <div style={{ overflowX: 'auto' }}><table className="data"><thead><tr><th>Row</th>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.slice(0, 10).map((row, index) => <tr key={index}><td>{index + 2}</td>{columns.map((column) => <td key={column}>{row[column]}</td>)}</tr>)}</tbody></table></div>
                <p className="hint">Showing 10 of {rows.length} rows. Final submission imports the complete validated file.</p>
            </>}
            {multiDomain && context.workflow && <div className="card" style={{ padding: 14, marginTop: 14 }}><h3>LAYERED APPROVAL WORKFLOW</h3><div className="form-grid">{(context.workflow.steps || []).map((step, index) => <div className="card" style={{ padding: 12 }} key={`${step.name}-${index}`}><strong>{index + 1}. {step.name}</strong><div className="hint">{step.department} · {step.permission}</div><span className="pill">{active.status === 'submitted' || index < context.workflow.currentStepIndex ? 'approved' : active.status === 'pending_approval' && index === context.workflow.currentStepIndex ? 'current' : 'waiting'}</span></div>)}</div>{(context.workflow.events || []).length > 0 && <div style={{ overflowX: 'auto', marginTop: 10 }}><table className="data"><thead><tr><th>Layer</th><th>Action</th><th>Person</th><th>Remarks</th><th>Time</th></tr></thead><tbody>{context.workflow.events.map((event, index) => <tr key={index}><td>{event.step_name}</td><td>{event.action}</td><td>{event.display_name || event.username}</td><td>{event.notes || '-'}</td><td>{new Date(event.created_at).toLocaleString()}</td></tr>)}</tbody></table></div>}</div>}
            {multiDomain && ['review', 'pending_approval'].includes(active.status) && <div className="field" style={{ marginTop: 14 }}><label>{active.status === 'review' ? 'Submission note' : 'Approval remarks *'}</label><textarea value={approvalNotes} onChange={(event) => setApprovalNotes(event.target.value)} placeholder={active.status === 'review' ? 'Optional note for the first reviewer' : 'Required remarks for approve, return, or reject'} /></div>}
            {active.status === 'review' && <div className="form-actions"><button className="btn btn-secondary" onClick={removeActive}>Remove review upload</button><button className="btn btn-secondary" disabled={busy} onClick={saveReview}>Save edited review</button><button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : multiDomain ? 'Submit for layered approval' : 'Approve and submit to departments'}</button></div>}
            {multiDomain && active.status === 'pending_approval' && <div className="form-actions"><button className="btn btn-secondary" disabled={busy} onClick={() => decideApproval('return')}>Return for correction</button><button className="btn btn-danger" disabled={busy} onClick={() => decideApproval('reject')}>Reject</button><button className="btn btn-primary" disabled={busy} onClick={() => decideApproval('approve')}>{busy ? 'Processing…' : `Approve ${context.workflow?.currentStep?.name || 'current layer'}`}</button></div>}
            {multiDomain && active.submission_result?.routed?.length > 0 && <div className="card" style={{ padding: 14, marginTop: 14 }}><h3>OPERATIONAL POSTING RESULTS</h3><div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}><div className="stat-card"><div className="label">Posted sections</div><div className="value">{active.submission_result.postedSections || 0}</div></div><div className="stat-card"><div className="label">Failed sections</div><div className="value">{active.submission_result.failedSections || 0}</div></div><div className="stat-card"><div className="label">Posted records</div><div className="value">{active.submission_result.records || 0}</div></div></div><div style={{ overflowX: 'auto' }}><table className="data"><thead><tr><th>Section</th><th>Department</th><th>Status</th><th>Records</th><th>Generated ERP records / error</th></tr></thead><tbody>{active.submission_result.routed.map((item, index) => <tr key={`${item.sectionId}-${index}`}><td>{item.result?.title || item.sectionId}</td><td>{item.department}</td><td><span className={`pill ${item.status === 'posted' ? 'pill-success' : 'pill-danger'}`}>{item.status || 'approved / pending posting'}</span></td><td>{item.records || 0}</td><td>{item.error || (item.result?.generated || item.result?.result?.generated || []).join(', ') || (item.skippedExisting ? 'Already posted; duplicate prevented' : '-')}</td></tr>)}</tbody></table></div></div>}
            {multiDomain && active.status === 'submitted' && !legacyApprovedPendingPosting && <div className="success-banner">Approved and preserved in the permanent reference library. No live operational or financial records were changed.</div>}
            {legacyApprovedPendingPosting && <div><div className="error-banner">Approval is complete. The marked operational sections are ready for explicit posting; reference history will remain preserved.</div><div className="form-actions"><button className="btn btn-primary" disabled={busy} onClick={postResults}>{busy ? 'Posting…' : 'Post marked sections to ERP'}</button></div></div>}
            {multiDomain && ['partially_posted', 'posting_failed'].includes(active.status) && <div><div className="error-banner">Some approved sections could not be posted. Open the failed section, correct its ERP destination, save the destinations, then retry. Successfully posted sections will not be duplicated.</div><div className="form-actions"><button className="btn btn-secondary" disabled={busy} onClick={saveReview}>{busy ? 'Saving…' : 'Save corrected destinations'}</button><button className="btn btn-primary" disabled={busy} onClick={postResults}>{busy ? 'Posting…' : 'Retry failed operational posting'}</button></div></div>}
        </div>}

        <div style={{ marginTop: 16 }}><h3>RECENT UPLOADS</h3>{(data?.jobs || []).slice(0, 8).map((job) => <button key={job.business_id} className="btn btn-secondary btn-sm" style={{ margin: '0 6px 6px 0' }} onClick={() => openJob(job.business_id)}>{job.business_id} · {String(job.detected_document_type || job.import_type).replace(/_/g, ' ')} · {job.row_count} records · {job.status}</button>)}</div>
    </section>;
}
