const fs = require('fs');
const crypto = require('crypto');
const XLSX = require('@e965/xlsx');
const mammoth = require('mammoth');

const norm = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const amount = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const parsed = Number(String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
};
const rounded = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const excelDate = (value) => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (typeof value === 'number' && value > 20000 && value < 100000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
    const raw = text(value).replace(/[()]/g, '');
    const dmy = raw.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
    if (dmy) return `${dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    const named = new Date(raw);
    return Number.isNaN(named.getTime()) ? null : named.toISOString().slice(0, 10);
};
const safeId = (value) => norm(value).slice(0, 55) || crypto.randomUUID().slice(0, 8);
const fingerprint = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function periodKey(value) {
    const source = String(value || '').toLowerCase();
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const month = months.findIndex((name) => source.includes(name) || source.includes(name.slice(0, 3)));
    const year = source.match(/\b(20\d{2})\b/)?.[1];
    return month >= 0 && year ? `${year}-${String(month + 1).padStart(2, '0')}` : '';
}
const rowValues = (row) => (row || []).map((value) => text(value));
const valueAt = (rows, row, col) => rows[row]?.[col];

function question(key, label, options, recommended = '', help = '') {
    return { key, label, type: 'select', required: true, options, value: recommended, help };
}
function makeSection({ type, title, sheetName, range, confidence, records, columns, summary, data = null, questions = [], selected = true, postingMode = 'review_only', warnings = [] }) {
    const section = { id: `${safeId(sheetName)}-${safeId(type)}-${safeId(title)}`, type, title, sheetName, range, confidence, selected, postingMode, postingIntent: 'reference', records, sourceSnapshot: JSON.parse(JSON.stringify(records || [])), columns, summary, data, questions, warnings };
    section.periodKey = periodKey(`${sheetName} ${title}`);
    section.fingerprint = fingerprint({ type, periodKey: section.periodKey, records });
    return section;
}

const rowKey = (row, index) => String(row?.sourceRow ?? row?.sourceLine ?? `row-${index}`);
const sameValue = (a, b) => typeof a === 'number' || typeof b === 'number' ? Math.abs(amount(a) - amount(b)) < 0.005 : text(a) === text(b);
function manualReview(section) {
    const source = section.sourceSnapshot || [], current = section.records || [], sourceByKey = new Map(source.map((row, index) => [rowKey(row, index), row]));
    const currentByKey = new Map(current.filter((row) => !row.manualEntry).map((row, index) => [rowKey(row, index), row]));
    const mismatches = [], numericDifferences = {};
    for (const [key, original] of sourceByKey) {
        const edited = currentByKey.get(key);
        if (!edited) { mismatches.push({ row: key, field: 'record', source: 'present', entered: 'removed' }); for (const [field, value] of Object.entries(original)) if (typeof value === 'number') numericDifferences[field] = rounded((numericDifferences[field] || 0) - value); continue; }
        for (const field of new Set([...Object.keys(original), ...Object.keys(edited)])) {
            if (['manualEntry', 'manualNote'].includes(field) || sameValue(original[field], edited[field])) continue;
            if (original[field] == null || original[field] === '') continue;
            mismatches.push({ row: key, field, source: original[field], entered: edited[field] });
            if (typeof original[field] === 'number' || typeof edited[field] === 'number') numericDifferences[field] = rounded((numericDifferences[field] || 0) + amount(edited[field]) - amount(original[field]));
        }
    }
    const formulaDifferences = [];
    for (const [index, row] of section.manualMode ? current.entries() : []) {
        if (section.type === 'raw_material_receiving') { const difference = rounded(amount(row.totalKg) - amount(row.quantity) * amount(row.kgPerUnit)); if (difference) formulaDifferences.push({ row: rowKey(row, index), formula: 'totalKg = quantity × kgPerUnit', difference }); }
        if (section.type.includes('payroll')) { const gross = amount(row.grossSalary) || amount(row.basicSalary) + amount(row.houseRent) + amount(row.firstIncrement) + amount(row.secondIncrement) + amount(row.conveyanceAllowance) + amount(row.medicalAllowance) + amount(row.da) + amount(row.utilityAllowance) + amount(row.otherAllowance); const deductions = amount(row.totalDeduction) || amount(row.advance) + amount(row.absenceDeduction) + amount(row.otherDeduction); if (row.netPayable !== undefined) { const difference = rounded(amount(row.netPayable) - (gross - deductions)); if (difference) formulaDifferences.push({ row: rowKey(row, index), formula: 'netPayable = gross − deductions', difference }); } }
    }
    const nonZeroDifferences = Object.entries(numericDifferences).filter(([, value]) => Math.abs(value) >= 0.005).map(([field, difference]) => ({ field, difference }));
    return { mismatches, numericDifferences, nonZeroDifferences, formulaDifferences, manualRows: current.filter((row) => row.manualEntry).length };
}

function findHeader(rows, aliasGroups, maxRows = 160) {
    for (let r = 0; r < Math.min(rows.length, maxRows); r++) {
        const normalized = rowValues(rows[r]).map(norm);
        const columns = {};
        for (const [field, aliases] of Object.entries(aliasGroups)) {
            const index = normalized.findIndex((value) => aliases.some((alias) => value === alias || value.includes(alias)));
            if (index >= 0) columns[field] = index;
        }
        const required = Object.keys(aliasGroups).filter((field) => aliasGroups[field].required);
        if ((!required.length && Object.keys(columns).length >= 3) || required.every((field) => columns[field] != null)) return { row: r, columns };
    }
    return null;
}

const PAYROLL_ALIASES = {
    employeeName: Object.assign(['nameoftheemployee', 'employeename', 'name'], { required: true }),
    designation: Object.assign(['designation', 'position'], { required: true }),
    basicSalary: ['basicsalary', 'totalsalary'], grossSalary: ['grosssalaryallowance', 'grosssalary'],
    houseRent: ['houserent'], firstIncrement: ['1stincrement', 'firstincrement'], secondIncrement: ['2ndincrement', 'secondincrement'],
    conveyanceAllowance: ['conveyanceallowance'], medicalAllowance: ['medicalallowance'], da: ['da'], utilityAllowance: ['utilityallowance'], otherAllowance: ['othersallowance', 'otherallowance'],
    totalDays: ['totaldayinmonths', 'totaldaysinmonths'], presentDays: ['present', 'dutyofdays'], leaveDays: ['leave'], absentDays: ['absent', 'absdays'],
    advance: ['paidinadvance', 'advance'], absenceDeduction: ['absencededuction'], otherDeduction: ['othersdeduction', 'otherdeduction'], totalDeduction: ['totaldeduction'],
    netPayable: Object.assign(['netpayable', 'netsalary', 'totalsalary'], { required: true }), bankAccount: ['bankaccountno', 'bankaccount']
};

function extractPayrollSections(sheetName, rows) {
    const header = findHeader(rows, PAYROLL_ALIASES, 40);
    if (!header) return [];
    const records = [];
    let category = /security/i.test(sheetName) ? 'OUTSOURCED_SECURITY' : null;
    let blanks = 0;
    for (let r = header.row + 1; r < rows.length; r++) {
        const first = text(valueAt(rows, r, 0));
        const name = text(valueAt(rows, r, header.columns.employeeName));
        if (/^(staff|worker|security)$/i.test(first)) { category = first.toUpperCase(); continue; }
        if (/^total\b|^in word/i.test(first) || /^total\b|^in word/i.test(name)) break;
        if (!name) { if (++blanks >= 8) break; continue; }
        blanks = 0;
        const record = { sourceRow: r + 1, employeeName: name, designation: text(valueAt(rows, r, header.columns.designation)), category: category || 'STAFF' };
        for (const field of Object.keys(PAYROLL_ALIASES).filter((key) => !['employeeName', 'designation'].includes(key))) {
            if (header.columns[field] != null) record[field] = field === 'bankAccount' ? text(valueAt(rows, r, header.columns[field])) : rounded(amount(valueAt(rows, r, header.columns[field])));
        }
        if (!record.designation && !record.basicSalary && !record.netPayable) continue;
        records.push(record);
    }
    if (!records.length) return [];
    const security = records.every((record) => record.category === 'OUTSOURCED_SECURITY') || /security/i.test(sheetName);
    return [makeSection({
        type: security ? 'outsourced_security_payroll' : 'employee_payroll', title: `${sheetName} payroll`, sheetName,
        range: `row ${header.row + 1} onward`, confidence: 0.98, records, columns: Object.keys(records[0]),
        summary: { employees: records.length, gross: rounded(records.reduce((sum, r) => sum + Number(r.grossSalary || r.basicSalary || 0), 0)), netPayable: rounded(records.reduce((sum, r) => sum + Number(r.netPayable || 0), 0)) },
        questions: security ? [
            question('postingTarget', 'How should this security sheet be posted?', ['vendor_bill', 'reference_only'], 'vendor_bill'),
            question('vendorMatch', 'Which security-service vendor should be matched?', ['ask_user_to_select_existing_vendor', 'create_new_vendor', 'do_not_create_vendor'], 'create_new_vendor')
        ] : [
            question('postingTarget', 'How should this payroll sheet be posted?', ['draft_payroll_run', 'employee_salary_history', 'reference_only'], 'draft_payroll_run'),
            question('employeeMatching', 'How should employee names be matched?', ['business_id_then_name', 'name_and_designation', 'manual_review_each_unmatched'], 'name_and_designation')
        ], postingMode: 'department_draft'
    })];
}

function accountHeaderRegions(rows) {
    const regions = [];
    for (let r = 0; r < Math.min(rows.length, 200); r++) {
        const normalized = rowValues(rows[r]).map(norm);
        for (let start = 0; start < normalized.length; start++) {
            if (normalized[start] !== 'date') continue;
            const end = Math.min(normalized.length, start + 14);
            const window = normalized.slice(start, end);
            const debit = window.findIndex((v) => v.includes('debittaka') || v === 'debit');
            const credit = window.findIndex((v) => v.includes('credittaka') || v === 'credit');
            const balance = window.findIndex((v) => v === 'balance');
            if (debit >= 0 && credit >= 0 && balance >= 0) regions.push({ row: r, start, end: start + Math.max(debit, credit, balance) + 1 });
        }
    }
    return regions.filter((region, index, all) => all.findIndex((other) => other.row === region.row && other.start === region.start) === index);
}
function extractAccountSections(sheetName, rows) {
    const sections = [];
    for (const region of accountHeaderRegions(rows)) {
        const header = rowValues(rows[region.row]);
        const map = {};
        for (let c = region.start; c <= region.end; c++) {
            const label = norm(header[c]);
            if (label === 'date') map.date = c;
            else if (label.includes('partyname') || label.includes('otherpurpose')) map.party = c;
            else if (label.includes('ledgerhead')) map.ledgerHead = c;
            else if (label === 'purpose') map.purpose = c;
            else if (label.includes('particular')) map.particular = c;
            else if (label.includes('vono')) map.voucher = c;
            else if (label.includes('debittaka') || label === 'debit') map.debit = c;
            else if (label.includes('credittaka') || label === 'credit') map.credit = c;
            else if (label === 'balance') map.balance = c;
        }
        const records = []; let blanks = 0;
        for (let r = region.row + 1; r < rows.length; r++) {
            const date = excelDate(valueAt(rows, r, map.date));
            const debit = amount(valueAt(rows, r, map.debit)); const credit = amount(valueAt(rows, r, map.credit));
            const party = text(valueAt(rows, r, map.party)); const ledgerHead = text(valueAt(rows, r, map.ledgerHead)); const particular = text(valueAt(rows, r, map.particular));
            if (!date && !debit && !credit && !party && !ledgerHead && !particular) { if (++blanks >= 12) break; continue; }
            blanks = 0;
            if (!date || (!debit && !credit)) continue;
            const purpose=text(valueAt(rows,r,map.purpose));const classification=classifyTransaction(`${party} ${ledgerHead} ${purpose} ${particular}`);
            records.push({ sourceRow: r + 1, date, party, ledgerHead, purpose, particular, voucherNumber: text(valueAt(rows, r, map.voucher)), debit: rounded(debit), credit: rounded(credit), balance: rounded(amount(valueAt(rows, r, map.balance))), transactionClass:classification.type, postingDestination:classification.destination });
        }
        if (records.length < 2) continue;
        const mismatchCount=debitDeposit=>records.slice(1).filter((row,index)=>Math.abs(rounded(row.balance-(records[index].balance+(debitDeposit?row.debit-row.credit:-row.debit+row.credit))))>.01).length;
        const inferredDebitMeaning=mismatchCount(true)<=mismatchCount(false)?'deposit':'withdrawal';
        const section=makeSection({ type: 'account_transactions', title: `${sheetName} account transactions`, sheetName, range: `row ${region.row + 1}, columns ${region.start + 1}-${region.end + 1}`, confidence: 0.97, records, columns: Object.keys(records[0]),
            summary: { transactions: records.length, debit: rounded(records.reduce((s, r) => s + r.debit, 0)), credit: rounded(records.reduce((s, r) => s + r.credit, 0)), closingBalance: records.at(-1)?.balance || 0, inferredDebitMeaning },
            questions: [question('accountMatch', 'Which ERP cash/bank account does this ledger represent?', ['ask_user_to_select_account', 'reference_only'], 'ask_user_to_select_account'), question('postingTarget', 'How should transactions be handled?', ['draft_for_accounts_review', 'reference_only', 'skip_section'], 'draft_for_accounts_review')], postingMode: 'department_draft' });section.postingOptions={debitMeaning:inferredDebitMeaning};sections.push(section);
    }
    return sections;
}

function classifyTransaction(value){const v=text(value).toLowerCase();if(/bank.*(account|statement)|account.*statement|atm[- ]?ggapl|bank[- ]?ggapl/.test(v))return{type:'bank_statement',destination:'account_reconciliation'};if(/deposit|deposite|cash received|bank received/.test(v))return{type:'bank_deposit',destination:'account_deposit'};if(/withdraw|withdrawn|cash out/.test(v))return{type:'bank_withdrawal',destination:'account_withdrawal'};if(/barrister|lawyer|lowyer|legal|advocate/.test(v))return{type:'legal_service',destination:'professional_service_expense'};if(/donat|charity/.test(v))return{type:'donation',destination:'donation_expense'};if(/expense|bill|cost|allowance/.test(v))return{type:'daily_expense',destination:'expense_review'};return{type:'daily_transaction',destination:'account_ledger'};}

function classifyCandidate(name){const v=text(name).toLowerCase();if(/^(cash|bank|atm|opening|closing|office expenses?|transaction|voucher raw)$/.test(v)||/^(cash|bank)\s*(deposit|deposite|withdraw|withdrawn)$/.test(v))return{candidateClass:/withdraw/.test(v)?'bank_withdrawal':/deposit/.test(v)?'bank_deposit':'transaction_heading',suggestedRole:'ignore',confidence:.99,selected:false};if(/(?:bank|atm)[- ]?ggapl|bank account|account statement/.test(v))return{candidateClass:'bank_account',suggestedRole:'account',confidence:.96,selected:true};if(/barrister|lawyer|lowyer|advocate/.test(v))return{candidateClass:'legal_service_provider',suggestedRole:'vendor',confidence:.92,selected:true};if(/donat|charity/.test(v))return{candidateClass:'donation_recipient',suggestedRole:'external_person',confidence:.88,selected:true};return{candidateClass:'business_party',suggestedRole:'unresolved_party',confidence:.55,selected:true};}

function contactFromDetail(value) {
    const raw = text(value); const phones = raw.match(/(?:\+?88[ -]?)?01\d(?:[ -]?\d){8}/g) || [];
    const proprietor = raw.match(/^\s*(?:Pro(?:prietor)?)[.;:]?\s*([^,;]+)/i)?.[1]?.trim() || '';
    return { proprietor, phones: phones.map((v) => v.replace(/\s/g, '')), phone: phones.map((v) => v.replace(/\s/g, '')).join(', '), address: raw.replace(/\bMobile\s*:.*$/i, '').replace(/^\s*(?:Pro(?:prietor)?)[.;:]?\s*[^,;]+[,;]?/i, '').trim() };
}
function findLabelInColumn(rows, label, column = 0, from = 0) { const wanted = norm(label); for (let r = from; r < rows.length; r++) if (norm(valueAt(rows, r, column)) === wanted) return r; return -1; }
function extractPartyLedger(sheetName, rows) {
    const firstReceived = findLabelInColumn(rows, 'Received Date');
    if (firstReceived < 0 || findLabelInColumn(rows, 'Product', 0, firstReceived) < 0 || findLabelInColumn(rows, 'Dalil No', 0, firstReceived) < 0) return null;
    const customerName = text(valueAt(rows, 3, 0)) || sheetName; const contact = contactFromDetail(valueAt(rows, 4, 0));
    const receipts = [];
    for (let r = 0; r < rows.length; r++) {
        if (norm(valueAt(rows, r, 0)) !== 'receiveddate') continue;
        const labels = {};
        for (let scan = r; scan <= Math.min(r + 10, rows.length - 1); scan++) labels[norm(valueAt(rows, scan, 0))] = scan;
        if (!['product', 'dalilno', 'totallot', 'kginperlot', 'totalkg'].every((key) => labels[key] != null)) continue;
        const reference = text(valueAt(rows, labels.dalilno, 1)); const quantity = amount(valueAt(rows, labels.totallot, 1)); const productName = text(valueAt(rows, labels.product, 1));
        if (!reference || !quantity || !productName) continue;
        let blockEnd = rows.length - 1; for (let scan = r + 1; scan < rows.length; scan++) if (norm(valueAt(rows, scan, 0)) === 'receiveddate') { blockEnd = scan - 1; break; }
        let delivered = 0, deliveryDate = null, gatePassReference = '', reportedRemaining = null, billedThroughDate = null;
        for (let scan = r; scan <= blockEnd; scan++) {
            const summary = norm(valueAt(rows, scan, 5));
            if (summary.includes('totaldeliveryindalil')) delivered = amount(valueAt(rows, scan, 7));
            if (summary.includes('totalstockindalil')) { reportedRemaining = amount(valueAt(rows, scan, 7)); billedThroughDate = excelDate(valueAt(rows, scan, 8)); }
            if (!deliveryDate && amount(valueAt(rows, scan, 7)) > 0) { deliveryDate = excelDate(valueAt(rows, scan, 6)); gatePassReference = text(valueAt(rows, scan, 8)).replace(/^-/, ''); }
        }
        const kgPerLot = amount(valueAt(rows, labels.kginperlot, 1)); const rentRate = amount(valueAt(rows, r, 2)); const laborRate = amount(valueAt(rows, r, 3));
        receipts.push({ sourceRow: r + 1, externalReference: reference, receivedDate: excelDate(valueAt(rows, r, 1)), productName: productName.replace(/gairlic/i, 'Garlic'), rawProductName: productName, totalLots: quantity, kgPerLot, totalKg: amount(valueAt(rows, labels.totalkg, 1)) || quantity * kgPerLot, rentRatePerKg: rentRate, laborRatePerLot: laborRate, rentAmount: amount(valueAt(rows, r, 5)) || quantity * kgPerLot * rentRate, laborAmount: amount(valueAt(rows, r, 4)) || quantity * laborRate, deliveredQuantity: delivered, remainingQuantity: reportedRemaining == null ? Math.max(0, quantity - delivered) : reportedRemaining, deliveryDate, gatePassReference, billedThroughDate, unit: 'lot' });
    }
    if (!receipts.length) return null;
    const payments = [];
    for (let r = 0; r < rows.length; r++) {
        const paymentDate = excelDate(valueAt(rows, r, 13)); const paymentAmount = amount(valueAt(rows, r, 14));
        if (paymentDate && paymentAmount) payments.push({ sourceRow: r + 1, paymentDate, amount: paymentAmount, rentAmount: amount(valueAt(rows, r, 15)), laborAmount: amount(valueAt(rows, r, 16)), reference: text(valueAt(rows, r, 17)) });
    }
    const data = { mode: 'structured', sheetName, customer: { name: customerName.replace(/^MS\s+/i, 'M/S '), entityKind: 'organization', customerType: 'cold_storage_client', contactName: contact.proprietor, phone: contact.phone, phones: contact.phones, address: contact.address }, products: [...new Set(receipts.map((r) => r.productName))].map((name) => ({ name, category: 'Cold storage goods', unit: 'lot' })), goodsReceipts: receipts, payments, deliveries: receipts.filter((r) => r.deliveredQuantity > 0), reconciliation: [] };
    return makeSection({ type: 'customer_stock_rental_ledger', title: customerName, sheetName, range: `A1:${rows.length}`, confidence: 0.99, records: receipts, columns: Object.keys(receipts[0]), data,
        summary: { customer: customerName, receipts: receipts.length, payments: payments.length, receivedUnits: rounded(receipts.reduce((s, r) => s + r.totalLots, 0)), deliveredUnits: rounded(receipts.reduce((s, r) => s + r.deliveredQuantity, 0)), remainingUnits: rounded(receipts.reduce((s, r) => s + r.remainingQuantity, 0)), rent: rounded(receipts.reduce((s, r) => s + r.rentAmount, 0)), labor: rounded(receipts.reduce((s, r) => s + r.laborAmount, 0)), paymentsReceived: rounded(payments.reduce((s, r) => s + r.amount, 0)) },
        questions: [question('entityRole', `Is ${customerName} a customer, vendor, or both?`, ['customer', 'vendor', 'both', 'other'], 'customer'), question('customerMatch', 'Match an existing customer or create a new one?', ['ask_user_to_select_existing_customer', 'create_new_customer', 'skip_entity'], 'ask_user_to_select_existing_customer'), question('warehouse', 'Where should the detected stock be posted?', ['ask_user_to_select_warehouse_and_location', 'reference_only'], 'ask_user_to_select_warehouse_and_location'), question('paymentAccount', 'Which account received detected payments?', ['ask_user_to_select_account', 'reference_only'], 'ask_user_to_select_account')], postingMode: 'supported_after_destination_review' });
}

function extractPartySummary(sheetName, rows) {
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
        const h = rowValues(rows[r]).map(norm); const party = h.indexOf('party'); const stock = h.indexOf('stock'); const delivery = h.indexOf('delivery'); const balance = h.findIndex((v) => v.includes('stockbalance'));
        if (party < 0 || stock < 0 || delivery < 0 || balance < 0) continue;
        const records = [];
        for (let x = r + 1; x < rows.length; x++) { const name = text(valueAt(rows, x, party)); if (!name) continue; records.push({ sourceRow: x + 1, partyName: name, stock: amount(valueAt(rows, x, stock)), delivery: amount(valueAt(rows, x, delivery)), stockBalance: amount(valueAt(rows, x, balance)), laborBill: amount(valueAt(rows, x, h.findIndex((v) => v.includes('lbbill')))), rentBill: amount(valueAt(rows, x, h.findIndex((v) => v.includes('rentbill')))), total: amount(valueAt(rows, x, h.indexOf('total'))) }); }
        if (records.length) return makeSection({ type: 'customer_balance_summary', title: `${sheetName} party summary`, sheetName, range: `row ${r + 1} onward`, confidence: 0.96, records, columns: Object.keys(records[0]), summary: { parties: records.length, stock: rounded(records.reduce((s, x) => s + x.stock, 0)), delivery: rounded(records.reduce((s, x) => s + x.delivery, 0)), balance: rounded(records.reduce((s, x) => s + x.stockBalance, 0)), totalDue: rounded(records.reduce((s, x) => s + x.total, 0)) }, questions: [question('postingTarget', 'Is this summary for reconciliation or transaction creation?', ['reconciliation_only', 'create_customer_opening_balances', 'skip_section'], 'create_customer_opening_balances')], postingMode: 'department_draft' });
    }
    return null;
}

function findReceivingHeaders(rows) {
    const result = [];
    for (let r = 0; r < Math.min(rows.length, 200); r++) { const h = rowValues(rows[r]).map(norm); const product = h.findIndex((v) => ['categories','category','product','description','particulars'].includes(v)); const quantity = h.findIndex((v) => /^(drums?|drumqnty|qtybag|bags?)$/.test(v)); const kg = h.findIndex((v) => v === 'kg' || v.includes('kgper')); const total = h.findIndex((v) => v === 'totalkg' || v.includes('quantitykg')); const vehicle = h.findIndex((v) => v === 'carno' || v.includes('vehiclenumber')); if (product >= 0 && quantity >= 0 && kg >= 0 && total >= 0) result.push({ row:r, product, quantity, kg, total, vehicle }); }
    return result;
}
function extractReceivingSections(sheetName, rows) {
    const sections = [];
    for (const header of findReceivingHeaders(rows)) {
        const records = []; let currentDate = null, blanks = 0;
        for (let r = header.row + 1; r < rows.length; r++) {
            const maybeDate = excelDate(valueAt(rows, r, 0)); if (maybeDate) currentDate = maybeDate;
            const productName = text(valueAt(rows, r, header.product)); const quantity = amount(valueAt(rows, r, header.quantity)); const kgPerUnit = amount(valueAt(rows, r, header.kg)); const totalKg = amount(valueAt(rows, r, header.total)) || quantity * kgPerUnit;
            if (!productName && !quantity && !totalKg) { if (++blanks >= 30) break; continue; } blanks = 0;
            if (!productName || !quantity || !kgPerUnit || !totalKg || /^total/i.test(productName)) continue;
            let date = currentDate; for (let c = 0; c < (rows[r] || []).length; c++) date = excelDate(valueAt(rows, r, c)) || date;
            records.push({ sourceRow:r+1, receivedDate:date, productName, quantity, unit:norm(valueAt(rows, header.row, header.quantity)).includes('bag')?'bag':'drum', kgPerUnit, totalKg:rounded(totalKg), vehicleNumber:header.vehicle>=0?text(valueAt(rows,r,header.vehicle)):'', externalReference:`${sheetName}:${r+1}:${header.vehicle>=0?text(valueAt(rows,r,header.vehicle)):''}` });
        }
        if (records.length) sections.push(makeSection({ type:'raw_material_receiving', title:`${sheetName} receiving`, sheetName, range:`row ${header.row+1} onward`, confidence:0.95, records, columns:Object.keys(records[0]), summary:{receipts:records.length, units:rounded(records.reduce((s,x)=>s+x.quantity,0)), totalKg:rounded(records.reduce((s,x)=>s+x.totalKg,0)), vehicles:new Set(records.map((x)=>x.vehicleNumber).filter(Boolean)).size}, questions:[question('ownerRole','Who owns the received goods?',['customer_owned_storage','company_owned_inventory','vendor_consignment','ask_for_each_product'],'company_owned_inventory'),question('ownerMatch','Which customer/vendor owns the goods?',['ask_user_to_select_entity','create_new_entity','reference_only'],'reference_only'),question('warehouse','Which warehouse and location received the goods?',['ask_user_to_select_warehouse_and_location','reference_only'],'ask_user_to_select_warehouse_and_location')], postingMode:'department_draft' }));
    }
    return sections;
}

function entityCandidates(sections) {
    const map = new Map();
    const add = (name, source, suggestedRole, confidence, candidateClass) => { const clean = text(name); if (!clean || clean.length < 3) return; const key = norm(clean),classified=classifyCandidate(clean),resolvedClass=classified.candidateClass==='business_party'&&candidateClass?candidateClass:classified.candidateClass; const current = map.get(key) || { id:key, name:clean, sources:[], candidateClass:resolvedClass, suggestedRole:classified.suggestedRole==='unresolved_party'?suggestedRole:classified.suggestedRole||suggestedRole, confidence:Math.max(confidence,classified.confidence), selected:classified.selected, role:classified.suggestedRole==='ignore'?'ignore':'', matchBusinessId:'', matchEntityType:'' }; if (!current.sources.includes(source)) current.sources.push(source); if (confidence > current.confidence && classified.candidateClass==='business_party') { current.suggestedRole=suggestedRole; current.candidateClass=resolvedClass; current.confidence=confidence; } map.set(key,current); };
    for (const section of sections) {
        if (section.type === 'customer_stock_rental_ledger') add(section.summary.customer, section.sheetName, 'customer', 0.98);
        if (section.type === 'customer_balance_summary') for (const row of section.records) add(row.partyName, section.sheetName, 'customer', 0.85);
        if (section.type === 'employee_payroll' || section.type === 'outsourced_security_payroll') for (const row of section.records) add(row.employeeName, section.sheetName, section.type === 'employee_payroll' ? 'staff' : 'external_person', 0.94);
        if (section.type === 'account_transactions') for (const row of section.records) if (row.party) add(row.party, section.sheetName,row.transactionClass==='legal_service'?'vendor':row.transactionClass==='donation'?'external_person':'unresolved_party',row.transactionClass==='legal_service'||row.transactionClass==='donation'?0.9:0.55,row.transactionClass==='legal_service'?'legal_service_provider':row.transactionClass==='donation'?'donation_recipient':null);
    }
    return [...map.values()].sort((a,b)=>b.confidence-a.confidence || a.name.localeCompare(b.name));
}

function readWorkbook(path) {
    const workbook = XLSX.readFile(path, { cellDates:true, cellFormula:true, cellNF:false, cellStyles:false, dense:false, codepage:65001 });
    return workbook.SheetNames.map((name) => ({ name, hidden: Boolean(workbook.Workbook?.Sheets?.find((s)=>s.name===name)?.Hidden), rows:XLSX.utils.sheet_to_json(workbook.Sheets[name], { header:1, raw:true, defval:null, blankrows:true }) }));
}
function detectLatest(sheetName, originalName) { const joined=`${sheetName} ${originalName}`; return /(?:july|jul)[ -]*2026|2026.*(?:july|jul)|10[.\/-]08[.\/-]26/i.test(joined); }

async function analyzeMultiDomainFile(file, requestedType='auto') {
    const extension = String(file.originalname || '').toLowerCase().split('.').pop();
    const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex');
    if (extension === 'docx') {
        const result = await mammoth.extractRawText({ path:file.path }); const lines=result.value.split(/\r?\n/).map(text).filter(Boolean); const records=[]; let currentDate=null;
        for (const line of lines) { const heading=line.match(/Receiving Status.*?(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})/i); if (heading) currentDate=excelDate(heading[1]); const match=line.match(/^\d+[.)]?\s*(.+?)\s*[:;-]\s*(\d+(?:\.\d+)?)\s*drums?\s*(?:x|×)\s*(\d+(?:\.\d+)?)\s*kg\s*=\s*([\d,.]+)\s*kg[,; ]+(.+)$/i); if (match) records.push({sourceLine:line,receivedDate:currentDate,productName:text(match[1]),quantity:amount(match[2]),unit:'drum',kgPerUnit:amount(match[3]),totalKg:amount(match[4]),vehicleNumber:text(match[5]),externalReference:`DOCX:${currentDate}:${text(match[5])}`}); }
        const section=makeSection({type:'raw_material_receiving',title:'Word receiving report',sheetName:'Document text',range:'document paragraphs',confidence:records.length?0.94:0.35,records,columns:records.length?Object.keys(records[0]):[],summary:{receipts:records.length,units:rounded(records.reduce((s,x)=>s+x.quantity,0)),totalKg:rounded(records.reduce((s,x)=>s+x.totalKg,0))},questions:[question('ownerRole','Who owns the received goods?',['customer_owned_storage','company_owned_inventory','vendor_consignment'],'customer_owned_storage'),question('warehouse','Which warehouse/location received the goods?',['ask_user_to_select_warehouse_and_location','reference_only'],'reference_only')],postingMode:'department_draft',warnings:records.length?[]:['No line matched the receiving pattern; manual mapping is required.']});
        return buildMultiResult(file.originalname, sourceHash, [{name:'Document text',hidden:false,rows:[]}], [section]);
    }
    if (!['xlsx','xls','xlsm'].includes(extension)) return null;
    const sheets=readWorkbook(file.path); const sections=[];
    for (const sheet of sheets) {
        const payroll=extractPayrollSections(sheet.name,sheet.rows); payroll.forEach((s)=>{if(!detectLatest(sheet.name,file.originalname))s.selected=false;}); sections.push(...payroll);
        sections.push(...extractAccountSections(sheet.name,sheet.rows));
        const ledger=extractPartyLedger(sheet.name,sheet.rows); if(ledger) sections.push(ledger);
        const summary=extractPartySummary(sheet.name,sheet.rows); if(summary) sections.push(summary);
        sections.push(...extractReceivingSections(sheet.name,sheet.rows));
    }
    if (!sections.length) sections.push(makeSection({type:'manual_data_entry',title:'Manual document review',sheetName:sheets[0]?.name||'Workbook',range:'undetected document content',confidence:0.2,records:[],columns:['description','amount','quantity','notes'],summary:{detectedRecords:0},questions:[question('postingTarget','How should this undetected document be handled?',['reference_only'],'reference_only')],postingMode:'review_only',warnings:['No operational table was detected. Enter missing rows and define the actual customer, vendor, staff member, or other entity manually.']}));
    return buildMultiResult(file.originalname,sourceHash,sheets,sections,requestedType);
}
function buildMultiResult(originalName,sourceHash,sheets,sections) {
    const fingerprints=new Map(); const duplicates=[];
    for(const section of sections){if(fingerprints.has(section.fingerprint)){section.duplicateOf=fingerprints.get(section.fingerprint);duplicates.push({sectionId:section.id,duplicateOf:section.duplicateOf});}else fingerprints.set(section.fingerprint,section.id);}
    const candidates=entityCandidates(sections); const byType=Object.fromEntries([...new Set(sections.map((s)=>s.type))].map((type)=>[type,sections.filter((s)=>s.type===type).length]));
    return { importType:'auto',detectedDocumentType:'multi_domain_business_workbook',columns:[],previewRows:[],fieldMapping:{},validationErrors:[],extractionResult:{mode:'multi_domain',version:2,originalName,workbook:{sheetCount:sheets.length,hiddenSheets:sheets.filter((s)=>s.hidden).map((s)=>s.name),analyzedSheets:sheets.map((s)=>({name:s.name,hidden:s.hidden,rows:s.rows.length}))},sections,entityCandidates:candidates,duplicates,sourceHash},sourceSummary:{sourceHash,sheets:sheets.length,sections:sections.length,selectedSections:sections.filter((s)=>s.selected).length,records:sections.reduce((sum,s)=>sum+s.records.length,0),entityCandidates:candidates.length,duplicates:duplicates.length,sectionTypes:byType},routingPlan:[...new Set(sections.map((s)=>s.type))].map((type)=>({department:type.includes('payroll')?'HR / Accounts':type==='account_transactions'?'Accounts':type.includes('receiving')?'Inventory / Cold Storage':type.includes('customer')?'Customer Management / Accounts':'Management Review',recordType:type,count:sections.filter((s)=>s.type===type).reduce((sum,s)=>sum+s.records.length,0),action:'Review detected sections, answer routing questions, and approve only selected records'}))};
}
function recalculateMultiDomainReview(input) {
    if(!input||input.mode!=='multi_domain')throw Object.assign(new Error('Multi-domain extraction is required'),{statusCode:400});
    const seenFingerprints=new Map(),duplicates=[];
    const sections=(input.sections||[]).map((section)=>{const current={...section,selected:Boolean(section.selected),questions:(section.questions||[]).map((q)=>({...q,value:text(q.value)}))};if(current.type==='customer_stock_rental_ledger'&&current.data)current.data={...current.data,goodsReceipts:current.records||[]};delete current.duplicateOf;current.periodKey=periodKey(`${current.sheetName} ${current.title}`);current.fingerprint=fingerprint({type:current.type,periodKey:current.periodKey,records:current.records||[]});if(seenFingerprints.has(current.fingerprint)){current.duplicateOf=seenFingerprints.get(current.fingerprint);duplicates.push({sectionId:current.id,duplicateOf:current.duplicateOf});}else seenFingerprints.set(current.fingerprint,current.id);return current;}); const validationErrors=[];
    for(const section of sections.filter((s)=>s.selected)){for(const q of section.questions||[]){if(q.required&&!q.value)validationErrors.push({field:`${section.id}.${q.key}`,message:`${section.title}: ${q.label}`});}const review=manualReview(section);section.manualReview=review;if(review.mismatches.length&&(!section.manualOverride?.confirmed||!text(section.manualOverride?.reason)))validationErrors.push({field:`${section.id}.manualOverride`,message:`${section.title}: confirm the ${review.mismatches.length} source mismatch(es) and enter an override reason`});for(const item of review.nonZeroDifferences)validationErrors.push({field:`${section.id}.${item.field}`,message:`${section.title}: ${item.field} reconciliation difference must equal zero (currently ${item.difference})`});for(const item of review.formulaDifferences)validationErrors.push({field:`${section.id}.${item.formula}`,message:`${section.title}: row ${item.row} calculation difference must equal zero (currently ${item.difference})`});if(section.type==='account_transactions'){const debitDeposit=section.postingOptions?.debitMeaning==='deposit',rows=section.records||[],seen=new Set();section.accountReconciliation=[];for(let i=0;i<rows.length;i++){const row=rows[i],key=fingerprint({date:row.date,party:norm(row.party),voucher:row.voucherNumber,debit:rounded(row.debit),credit:rounded(row.credit)});if(seen.has(key))validationErrors.push({field:`${section.id}.duplicate.${row.sourceRow}`,message:`${section.title}: possible duplicate transaction at source row ${row.sourceRow}`});seen.add(key);if(i===0)continue;const previous=amount(rows[i-1].balance),expected=rounded(previous+(debitDeposit?amount(row.debit)-amount(row.credit):-amount(row.debit)+amount(row.credit))),reported=rounded(row.balance),difference=rounded(reported-expected);section.accountReconciliation.push({sourceRow:row.sourceRow,expected,reported,difference,status:Math.abs(difference)<=.01?'matched':'mismatch'});if(Math.abs(difference)>.01)validationErrors.push({field:`${section.id}.balance.${row.sourceRow}`,message:`${section.title}: row ${row.sourceRow} balance difference must equal zero (currently ${difference})`});}}}
    for(const entity of input.entityCandidates||[]){if(entity.selected&&!entity.role)validationErrors.push({severity:'warning',field:`entity.${entity.id}`,message:`Confirm whether ${entity.name} is an account, customer, vendor, staff member, legal provider, donation recipient, or transaction heading.`});if(entity.selected&&entity.role==='account'&&!entity.matchBusinessId)validationErrors.push({field:`entity.${entity.id}`,message:`${entity.name}: select the existing ERP bank/cash account; account headings cannot create people.`});}
    const extractionResult={...input,sections,duplicates,reviewedAt:new Date().toISOString()}; const sourceSummary={sourceHash:input.sourceHash,sheets:input.workbook?.sheetCount||0,sections:sections.length,selectedSections:sections.filter((s)=>s.selected).length,records:sections.filter((s)=>s.selected).reduce((sum,s)=>sum+(s.records||[]).length,0),entityCandidates:(input.entityCandidates||[]).length,duplicates:duplicates.length,sectionTypes:Object.fromEntries([...new Set(sections.map((s)=>s.type))].map((type)=>[type,sections.filter((s)=>s.type===type&&s.selected).length]))};
    const routingPlan=[...new Set(sections.filter((s)=>s.selected).map((s)=>s.type))].map((type)=>({department:type.includes('payroll')?'HR / Accounts':type==='account_transactions'?'Accounts':type.includes('receiving')?'Inventory / Cold Storage':type.includes('customer')?'Customer Management / Accounts':'Management Review',recordType:type,count:sections.filter((s)=>s.type===type&&s.selected).reduce((sum,s)=>sum+(s.records||[]).length,0),action:'Stage selected records for destination review; no operational posting occurs until destination approval'}));
    return {extractionResult,sourceSummary,routingPlan,validationErrors};
}

module.exports={analyzeMultiDomainFile,recalculateMultiDomainReview};
