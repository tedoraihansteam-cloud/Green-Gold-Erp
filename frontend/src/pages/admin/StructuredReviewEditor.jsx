const inputStyle = { minWidth: 105, padding: '7px 8px' };
const numericFields = new Set(['totalLots', 'kgPerLot', 'rentRatePerKg', 'laborRatePerLot', 'deliveredQuantity', 'amount', 'rentAmount', 'laborAmount']);

function EditableInput({ label, field, value, onChange }) {
    const numeric = numericFields.has(field);
    return <input aria-label={label} title={label} style={inputStyle} type={numeric ? 'number' : field.toLowerCase().includes('date') ? 'date' : 'text'} min={numeric ? 0 : undefined} step={numeric ? 'any' : undefined} value={value ?? ''} onChange={(event) => onChange(field, numeric ? event.target.valueAsNumber || 0 : event.target.value)} />;
}

export default function StructuredReviewEditor({ extraction, setExtraction, context, options, setOptions }) {
    const customerMatch = context.customerMatch || { status: 'new' };
    const updateCustomer = (field, value) => {
        setExtraction((current) => ({ ...current, customer: { ...(current.customer || {}), [field]: value } }));
        if (field === 'name' || field === 'phone') setOptions((current) => ({ ...current, customerBusinessId: '' }));
    };
    const updateReceipt = (index, field, value) => setExtraction((current) => ({ ...current, goodsReceipts: (current.goodsReceipts || []).map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row) }));
    const removeReceipt = (index) => setExtraction((current) => ({ ...current, goodsReceipts: (current.goodsReceipts || []).filter((_, rowIndex) => rowIndex !== index) }));
    const addReceipt = () => setExtraction((current) => ({ ...current, goodsReceipts: [...(current.goodsReceipts || []), { externalReference: '', receivedDate: new Date().toISOString().slice(0, 10), productName: '', rawProductName: '', totalLots: 0, kgPerLot: 0, rentRatePerKg: 0, laborRatePerLot: 0, deliveredQuantity: 0, deliveryDate: null, gatePassReference: '' }] }));
    const updatePayment = (index, field, value) => setExtraction((current) => ({ ...current, payments: (current.payments || []).map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row) }));
    const removePayment = (index) => setExtraction((current) => ({ ...current, payments: (current.payments || []).filter((_, rowIndex) => rowIndex !== index) }));
    const addPayment = () => setExtraction((current) => ({ ...current, payments: [...(current.payments || []), { paymentDate: new Date().toISOString().slice(0, 10), reference: '', amount: 0, rentAmount: 0, laborAmount: 0 }] }));

    return <div className="card" style={{ padding: 16, margin: '14px 0', borderColor: 'var(--brand)' }}>
        <div className="card-header"><div><h3>EDIT DETECTED DATA</h3><p className="card-subtitle">Correct the extracted values here, then save the review. Calculated stock, charges, payments, and dues are refreshed by the server.</p></div><span className={`pill ${customerMatch.status === 'registered' ? 'pill-success' : ''}`}>{customerMatch.status === 'registered' ? 'Registered customer detected' : 'New customer will be created'}</span></div>
        {customerMatch.status === 'registered' ? <div className="success-banner">Matched {customerMatch.businessId} · {customerMatch.name}. The portal will use this customer and will not create a duplicate.</div> : <div className="hint" style={{ marginBottom: 12 }}>No registered customer matched the detected name or phone. A new organization customer will be generated automatically after final approval.</div>}

        <h3>CUSTOMER DETAILS</h3>
        <div className="form-grid">
            <div className="field"><label>Organization/customer name</label><input value={extraction.customer?.name || ''} onChange={(event) => updateCustomer('name', event.target.value)} /></div>
            <div className="field"><label>Contact person</label><input value={extraction.customer?.contactName || ''} onChange={(event) => updateCustomer('contactName', event.target.value)} /></div>
            <div className="field"><label>Phone numbers</label><input value={extraction.customer?.phone || ''} onChange={(event) => updateCustomer('phone', event.target.value)} /></div>
            <div className="field"><label>Address</label><input value={extraction.customer?.address || ''} onChange={(event) => updateCustomer('address', event.target.value)} /></div>
        </div>

        <div className="card-header" style={{ marginTop: 14 }}><div><h3>STOCK, RENT AND LABOR ROWS</h3><p className="card-subtitle">Rent and labor totals are calculated from quantity × rate after saving.</p></div><button type="button" className="btn btn-secondary btn-sm" onClick={addReceipt}>Add stock row</button></div>
        <div style={{ overflowX: 'auto' }}><table className="data"><thead><tr><th>Dalil/reference</th><th>Received</th><th>Product</th><th>Lots</th><th>Kg/lot</th><th>Rent/kg</th><th>Labor/lot</th><th>Delivered</th><th>Delivery date</th><th>Gate pass</th><th></th></tr></thead><tbody>{(extraction.goodsReceipts || []).map((row, index) => <tr key={`${row.sourceRow || 'new'}-${index}`}>
            <td><EditableInput label={`Row ${index + 1} Dalil/reference`} field="externalReference" value={row.externalReference} onChange={(field, value) => updateReceipt(index, field, value)} /></td>
            <td><EditableInput label={`Row ${index + 1} received date`} field="receivedDate" value={row.receivedDate} onChange={(field, value) => updateReceipt(index, field, value)} /></td>
            <td><EditableInput label={`Row ${index + 1} product`} field="productName" value={row.productName} onChange={(field, value) => updateReceipt(index, field, value)} /></td>
            {['totalLots', 'kgPerLot', 'rentRatePerKg', 'laborRatePerLot', 'deliveredQuantity'].map((field) => <td key={field}><EditableInput label={`Row ${index + 1} ${field}`} field={field} value={row[field]} onChange={(name, value) => updateReceipt(index, name, value)} /></td>)}
            <td><EditableInput label={`Row ${index + 1} delivery date`} field="deliveryDate" value={row.deliveryDate} onChange={(field, value) => updateReceipt(index, field, value)} /></td>
            <td><EditableInput label={`Row ${index + 1} gate pass`} field="gatePassReference" value={row.gatePassReference} onChange={(field, value) => updateReceipt(index, field, value)} /></td>
            <td><button type="button" className="btn btn-secondary btn-sm" onClick={() => removeReceipt(index)}>Remove</button></td>
        </tr>)}</tbody></table></div>

        <div className="card-header" style={{ marginTop: 14 }}><div><h3>RECEIVED PAYMENTS</h3><p className="card-subtitle">Payments will be allocated only to dues generated from this import.</p></div><button type="button" className="btn btn-secondary btn-sm" onClick={addPayment}>Add payment</button></div>
        <div style={{ overflowX: 'auto' }}><table className="data"><thead><tr><th>Date</th><th>Money receipt/reference</th><th>Amount</th><th>Rent part</th><th>Labor part</th><th></th></tr></thead><tbody>{(extraction.payments || []).map((row, index) => <tr key={`${row.sourceRow || 'new'}-${index}`}>
            {['paymentDate', 'reference', 'amount', 'rentAmount', 'laborAmount'].map((field) => <td key={field}><EditableInput label={`Payment ${index + 1} ${field}`} field={field} value={row[field]} onChange={(name, value) => updatePayment(index, name, value)} /></td>)}
            <td><button type="button" className="btn btn-secondary btn-sm" onClick={() => removePayment(index)}>Remove</button></td>
        </tr>)}</tbody></table></div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}><input type="checkbox" checked={!!options.confirmAdjustments} onChange={(event) => setOptions((current) => ({ ...current, confirmAdjustments: event.target.checked }))} /> I confirm any edited values and authorize the revised totals for final submission.</label>
    </div>;
}
