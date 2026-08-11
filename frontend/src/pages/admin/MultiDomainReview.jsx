import { useMemo, useState } from 'react';

const label = (value) => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const compact = (value) => value == null ? '' : typeof value === 'number' ? value.toLocaleString() : String(value);

export default function MultiDomainReview({ extraction, setExtraction, context }) {
    const [typeFilter, setTypeFilter] = useState('all');
    const [openSection, setOpenSection] = useState('');
    const [entityLimit, setEntityLimit] = useState(40);
    const sections = extraction.sections || [];
    const entities = extraction.entityCandidates || [];
    const types = useMemo(() => [...new Set(sections.map((section) => section.type))], [sections]);
    const visibleSections = sections.filter((section) => typeFilter === 'all' || section.type === typeFilter);

    const updateSection = (id, patch) => setExtraction((current) => ({
        ...current,
        sections: (current.sections || []).map((section) => section.id === id ? { ...section, ...patch } : section)
    }));
    const answer = (sectionId, key, value) => setExtraction((current) => ({
        ...current,
        sections: (current.sections || []).map((section) => section.id === sectionId ? {
            ...section, questions: (section.questions || []).map((question) => question.key === key ? { ...question, value } : question)
        } : section)
    }));
    const updateEntity = (id, patch) => setExtraction((current) => ({
        ...current,
        entityCandidates: (current.entityCandidates || []).map((entity) => entity.id === id ? { ...entity, ...patch } : entity)
    }));
    const updatePosting = (id, patch) => setExtraction((current) => ({
        ...current,
        sections: (current.sections || []).map((section) => section.id === id ? { ...section, postingOptions: { ...(section.postingOptions || {}), ...patch } } : section)
    }));
    const selectVisible = (selected) => setExtraction((current) => ({
        ...current,
        sections: (current.sections || []).map((section) => (typeFilter === 'all' || section.type === typeFilter) ? { ...section, selected } : section)
    }));

    return <div>
        <div className="success-banner"><strong>Controlled data extraction</strong><div>{context.postingMessage || 'Selected data requires every configured approval layer before department routing.'}</div></div>
        {(context.duplicateUploads || []).length > 0 && <div className="error-banner"><strong>Exact file duplicate detected</strong>{context.duplicateUploads.map((item) => <div key={item.business_id}>{item.original_name} · {item.business_id} · {item.status}</div>)}</div>}

        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', margin: '14px 0' }}>
            {[['Worksheets', extraction.workbook?.sheetCount], ['Detected sections', sections.length], ['Selected sections', sections.filter((section) => section.selected).length], ['Extracted records', sections.reduce((sum, section) => sum + (section.records?.length || 0), 0)], ['People / organizations', entities.length], ['Duplicate sections', extraction.duplicates?.length || 0]].map(([name, value]) => <div className="stat-card" key={name}><div className="label">{name}</div><div className="value" style={{ fontSize: 22 }}>{Number(value || 0).toLocaleString()}</div></div>)}
        </div>

        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="card-header"><div><h3>Detected workbook sections</h3><p className="card-subtitle">Select only the information that belongs in the ERP, then answer its routing questions.</p></div><div><button className="btn btn-secondary btn-sm" onClick={() => selectVisible(true)}>Select visible</button> <button className="btn btn-secondary btn-sm" onClick={() => selectVisible(false)}>Clear visible</button></div></div>
            <div className="field" style={{ maxWidth: 420 }}><label>Filter department data</label><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All detected types ({sections.length})</option>{types.map((type) => <option key={type} value={type}>{label(type)} ({sections.filter((section) => section.type === type).length})</option>)}</select></div>
            {visibleSections.map((section) => {
                const isOpen = openSection === section.id;
                const columns = (section.columns || []).slice(0, 10);
                return <div className="card" style={{ padding: 12, marginTop: 10, opacity: section.selected ? 1 : 0.65 }} key={section.id}>
                    <div className="card-header">
                        <div><label style={{ display: 'flex', gap: 9, alignItems: 'center' }}><input type="checkbox" checked={Boolean(section.selected)} onChange={(event) => updateSection(section.id, { selected: event.target.checked })} /><strong>{section.title}</strong></label><div className="hint">{section.sheetName} · {label(section.type)} · {(section.records?.length || 0).toLocaleString()} records · {Math.round(Number(section.confidence || 0) * 100)}% confidence</div></div>
                        <button className="btn btn-secondary btn-sm" onClick={() => setOpenSection(isOpen ? '' : section.id)}>{isOpen ? 'Close details' : 'Review details'}</button>
                    </div>
                    {section.duplicateOf && <div className="error-banner">Possible duplicate of section {section.duplicateOf} for the same reporting period; verify it before selecting.</div>}
                    {isOpen && <div>
                        {(section.warnings || []).map((warning, index) => <div className="error-banner" key={index}>{warning}</div>)}
                        {section.type.includes('payroll') && <div className="form-grid"><div className="field"><label>ERP department for unmatched staff</label><select value={section.postingOptions?.departmentBusinessId || ''} onChange={(event) => updatePosting(section.id, { departmentBusinessId: event.target.value })}><option value="">No department / match existing staff</option>{(context.departments || []).map((row) => <option key={row.business_id} value={row.business_id}>{row.branch_name} · {row.name}</option>)}</select></div>{section.type === 'outsourced_security_payroll' && <div className="field"><label>Security service vendor</label><select value={section.postingOptions?.vendorBusinessId || ''} onChange={(event) => updatePosting(section.id, { vendorBusinessId: event.target.value })}><option value="">Automatically match or create vendor</option>{(context.vendors || []).map((row) => <option key={row.business_id} value={row.business_id}>{row.business_id} · {row.name}</option>)}</select></div>}</div>}
                        {section.type === 'account_transactions' && <div className="form-grid"><div className="field"><label>ERP cash/bank account *</label><select value={section.postingOptions?.accountBusinessId || ''} onChange={(event) => updatePosting(section.id, { accountBusinessId: event.target.value })}><option value="">Auto-select only available account</option>{(context.accounts || []).map((row) => <option key={row.business_id} value={row.business_id}>{row.business_id} · {row.name}</option>)}</select></div><div className="field"><label>Debit column means</label><select value={section.postingOptions?.debitMeaning || 'withdrawal'} onChange={(event) => updatePosting(section.id, { debitMeaning: event.target.value })}><option value="withdrawal">Money paid / withdrawal</option><option value="deposit">Money received / deposit</option></select></div></div>}
                        {(section.type.includes('receiving') || section.type === 'customer_stock_rental_ledger') && <div className="form-grid"><div className="field"><label>Receiving warehouse *</label><select value={section.postingOptions?.warehouseBusinessId || ''} onChange={(event) => updatePosting(section.id, { warehouseBusinessId: event.target.value, locationBusinessId: '' })}><option value="">Auto-select only available warehouse</option>{(context.warehouses || []).map((row) => <option key={row.business_id} value={row.business_id}>{row.business_id} · {row.name}</option>)}</select></div><div className="field"><label>Storage location</label><select value={section.postingOptions?.locationBusinessId || ''} onChange={(event) => { const location = (context.locations || []).find((row) => row.business_id === event.target.value); updatePosting(section.id, { locationBusinessId: event.target.value, warehouseBusinessId: location?.warehouse_business_id || section.postingOptions?.warehouseBusinessId || '' }); }}><option value="">No location assignment</option>{(context.locations || []).filter((row) => !section.postingOptions?.warehouseBusinessId || row.warehouse_business_id === section.postingOptions.warehouseBusinessId).map((row) => <option key={row.business_id} value={row.business_id}>{row.warehouse_name} · {row.name}</option>)}</select></div><div className="field"><label>Owner customer</label><select value={section.postingOptions?.customerBusinessId || ''} onChange={(event) => updatePosting(section.id, { customerBusinessId: event.target.value })}><option value="">Auto-match/create from document</option>{(context.customers || []).map((row) => <option key={row.business_id} value={row.business_id}>{row.business_id} · {row.name}</option>)}</select></div>{section.type === 'customer_stock_rental_ledger' && <div className="field"><label>Payment receiving account</label><select value={section.postingOptions?.accountBusinessId || ''} onChange={(event) => updatePosting(section.id, { accountBusinessId: event.target.value })}><option value="">Auto-select when only one account exists</option>{(context.accounts || []).map((row) => <option key={row.business_id} value={row.business_id}>{row.business_id} · {row.name}</option>)}</select></div>}</div>}
                        {(section.questions || []).map((question) => <div className="field" key={question.key}><label>{question.label} *</label><select value={question.value || ''} onChange={(event) => answer(section.id, question.key, event.target.value)}><option value="">Select an answer</option>{(question.options || []).map((option) => <option value={option} key={option}>{label(option)}</option>)}</select>{question.help && <div className="hint">{question.help}</div>}</div>)}
                        {section.summary && <div className="hint" style={{ margin: '8px 0' }}>{Object.entries(section.summary).map(([key, value]) => `${label(key)}: ${compact(value)}`).join(' · ')}</div>}
                        <div style={{ overflowX: 'auto' }}><table className="data"><thead><tr><th>Source</th>{columns.map((column) => <th key={column}>{label(column)}</th>)}</tr></thead><tbody>{(section.records || []).slice(0, 8).map((record, index) => <tr key={index}><td>{record.sourceRow || record.sourceLine || index + 1}</td>{columns.map((column) => <td key={column}>{compact(record[column])}</td>)}</tr>)}</tbody></table></div>
                        <p className="hint">Showing up to 8 of {(section.records?.length || 0).toLocaleString()} extracted records.</p>
                    </div>}
                </div>;
            })}
        </div>

        <div className="card" style={{ padding: 14 }}>
            <h3>Detected people and organizations</h3>
            <p className="card-subtitle">The extractor does not guess that every name is a vendor. Confirm the role or ignore it. Operational matching remains locked in this demo.</p>
            <div style={{ overflowX: 'auto' }}><table className="data"><thead><tr><th>Use</th><th>Name</th><th>Suggested</th><th>Confirmed role</th><th>Source</th></tr></thead><tbody>{entities.slice(0, entityLimit).map((entity) => <tr key={entity.id}><td><input type="checkbox" checked={Boolean(entity.selected)} onChange={(event) => updateEntity(entity.id, { selected: event.target.checked })} /></td><td>{entity.name}</td><td>{label(entity.suggestedRole)} · {Math.round(Number(entity.confidence || 0) * 100)}%</td><td><select value={entity.role || ''} onChange={(event) => updateEntity(entity.id, { role: event.target.value })}><option value="">Needs confirmation</option><option value="customer">Customer</option><option value="vendor">Vendor</option><option value="staff">Staff</option><option value="external_person">External person</option><option value="both">Customer and vendor</option><option value="other">Other / reference only</option><option value="ignore">Ignore</option></select></td><td>{(entity.sources || []).join(', ')}</td></tr>)}</tbody></table></div>
            {entityLimit < entities.length && <button className="btn btn-secondary btn-sm" onClick={() => setEntityLimit((value) => value + 100)}>Show 100 more</button>}
        </div>
    </div>;
}
