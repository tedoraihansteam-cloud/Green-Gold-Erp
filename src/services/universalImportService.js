const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const FLAT_TARGETS = {
    customer: ['name', 'phone', 'email', 'address', 'customerType'],
    product: ['name', 'sku', 'category', 'unit', 'unitPrice', 'monthlyRentPerUnit'],
    vendor: ['name', 'phone', 'email', 'address', 'vendorType']
};

const norm = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const number = (value) => {
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'result')) value = value.result;
    const parsed = Number(String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
};
const rounded = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const cellValue = (sheet, row, column) => {
    const cell = sheet.getCell(row, column);
    const value = cell.value;
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'result')) return value.result;
    if (value && typeof value === 'object' && value.richText) return value.richText.map((part) => part.text).join('');
    return value;
};
const cellText = (sheet, row, column) => {
    try { return String(sheet.getCell(row, column).text || cellValue(sheet, row, column) || '').trim(); }
    catch { return String(cellValue(sheet, row, column) || '').trim(); }
};
function isoDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (typeof value === 'number' && value > 20000) return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
    const text = String(value ?? '').trim();
    const dmy = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}
function normalizeProductName(name) {
    const fixes = { gairlic: 'Garlic', garlick: 'Garlic' };
    return fixes[norm(name)] || String(name || '').trim();
}
function parseCsv(text) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) return [];
    const split = (line) => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
    const headers = split(lines[0]);
    return lines.slice(1).map((line) => Object.fromEntries(headers.map((header, index) => [header, split(line)[index] || ''])));
}
function inferFlatType(columns, requestedType) {
    if (FLAT_TARGETS[requestedType]) return requestedType;
    const joined = columns.map(norm);
    if (joined.some((x) => x.includes('vendor') || x.includes('supplier'))) return 'vendor';
    if (joined.some((x) => x.includes('sku') || x.includes('product') || x.includes('unitprice'))) return 'product';
    return 'customer';
}
function suggestMapping(columns, type) {
    return Object.fromEntries((FLAT_TARGETS[type] || []).map((target) => [target, columns.find((column) => norm(column) === norm(target) || norm(column).includes(norm(target))) || '']));
}
function analyzeFlat(rows, requestedType) {
    if (!rows.length) throw Object.assign(new Error('The uploaded file has no data rows'), { statusCode: 400 });
    const columns = Object.keys(rows[0]).filter(Boolean);
    if (!columns.length) throw Object.assign(new Error('The file needs a header row'), { statusCode: 400 });
    const type = inferFlatType(columns, requestedType);
    const mapping = suggestMapping(columns, type);
    return {
        importType: type,
        detectedDocumentType: `${type}_master_list`,
        columns,
        previewRows: rows,
        fieldMapping: mapping,
        validationErrors: mapping.name ? [] : [{ row: null, field: 'name', message: 'Map a source column to the required name field before submission' }],
        extractionResult: { mode: 'flat', recordType: type, rows: rows.length },
        sourceSummary: { records: rows.length },
        routingPlan: [{ department: type === 'product' ? 'Inventory' : type === 'vendor' ? 'Procurement / Accounts' : 'Customer Management', recordType: type, count: rows.length, action: `Create ${type} master records` }]
    };
}
function findLabelRow(sheet, column, label, from = 1, to = sheet.rowCount) {
    const wanted = norm(label);
    for (let row = from; row <= to; row++) if (norm(cellText(sheet, row, column)) === wanted) return row;
    return null;
}
function extractContact(detail) {
    const phones = String(detail || '').match(/(?:\+?88)?01\d{9}/g) || [];
    const proprietor = String(detail || '').match(/^\s*(?:Pro(?:prietor)?)[.;:]?\s*([^,;]+)/i)?.[1]?.trim() || null;
    let address = String(detail || '').replace(/\bMobile\s*:.*$/i, '').trim().replace(/^\s*(?:Pro(?:prietor)?)[.;:]?\s*[^,;]+[,;]?\s*/i, '').replace(/[;,]+/g, ',').replace(/^,|,$/g, '').trim();
    return { phone: phones.join(', '), phones, proprietor, address };
}

const PRAN_HEADER_ALIASES = {
    receivedDate: ['receiveddate', 'recevieddate', 'date'], deliveryDate: ['deliverydate'], gatePass: ['gpass', 'gatepass'],
    vehicle: ['vehiclenumber', 'carno'], product: ['category', 'categories', 'description', 'particulars'],
    quantity: ['drum', 'drumqnty', 'drums', 'qtybag', 'bag'], kgPerUnit: ['kgperdrum', 'drumperkg', 'drumkg', 'kgperbag', 'kgbag', 'kg'],
    totalKg: ['quantitykg', 'totalkg', 'totalkgbag']
};
function findTabularHeader(sheet) {
    for (let row = 1; row <= Math.min(sheet.rowCount, 150); row++) {
        const found = {};
        for (let column = 1; column <= Math.min(sheet.columnCount, 30); column++) {
            const value = norm(cellText(sheet, row, column));
            for (const [target, aliases] of Object.entries(PRAN_HEADER_ALIASES)) if (!found[target] && aliases.includes(value)) found[target] = column;
        }
        if (found.product && found.quantity && found.kgPerUnit && found.totalKg && (found.receivedDate || found.deliveryDate)) return { row, columns: found };
    }
    return null;
}
function extractPranWorkbook(workbook) {
    const receipts = [];
    const detectedSheets = [];
    const seen = new Set();
    for (const sheet of workbook.worksheets) {
        const header = findTabularHeader(sheet);
        if (!header) continue;
        let sheetCount = 0;
        for (let row = header.row + 1; row <= sheet.rowCount; row++) {
            const productName = String(cellText(sheet, row, header.columns.product) || '').replace(/\s+/g, ' ').trim();
            const totalLots = number(cellValue(sheet, row, header.columns.quantity));
            const kgPerLot = number(cellValue(sheet, row, header.columns.kgPerUnit));
            const totalKg = number(cellValue(sheet, row, header.columns.totalKg)) || rounded(totalLots * kgPerLot);
            if (!productName || /^total\b/i.test(productName) || totalLots <= 0 || kgPerLot <= 0 || totalKg <= 0) continue;
            const gatePassReference = header.columns.gatePass ? cellText(sheet, row, header.columns.gatePass).replace(/^-/, '') : '';
            const vehicleNumber = header.columns.vehicle ? cellText(sheet, row, header.columns.vehicle) : '';
            const receivedDate = isoDate(header.columns.receivedDate ? cellValue(sheet, row, header.columns.receivedDate) : cellValue(sheet, row, header.columns.deliveryDate));
            if (!receivedDate) continue;
            const sourceReference = gatePassReference || `${receivedDate}:${vehicleNumber || sheet.name}:${row}`;
            const key = [sourceReference, norm(productName), totalLots, kgPerLot].join('|');
            if (seen.has(key)) continue;
            seen.add(key);
            const unitHeader = norm(cellText(sheet, header.row, header.columns.quantity));
            receipts.push({
                sourceSheet: sheet.name, sourceRow: row, externalReference: `${sourceReference}:${norm(productName).slice(0, 40)}`, receivedDate,
                rawProductName: productName, productName: normalizeProductName(productName), totalLots, kgPerLot, totalKg,
                unit: unitHeader.includes('bag') ? 'bag' : 'drum', vehicleNumber: vehicleNumber || null,
                gatePassReference: gatePassReference || null, rentRatePerKg: 0, rentRatePerLot: 0, laborRatePerLot: 0,
                laborAmount: 0, rentAmount: 0, deliveredQuantity: 0, remainingQuantity: totalLots,
                deliveryDate: null, billedThroughDate: null
            });
            sheetCount++;
        }
        if (sheetCount) detectedSheets.push({ name: sheet.name, records: sheetCount });
    }
    if (!receipts.length) return null;
    const totalUnits = rounded(receipts.reduce((sum, item) => sum + item.totalLots, 0));
    const totalKg = rounded(receipts.reduce((sum, item) => sum + item.totalKg, 0));
    const products = [...new Set(receipts.map((item) => item.productName))].map((name) => ({ name, category: 'Raw material', unit: 'kg' }));
    const warnings = [];
    if (totalUnits > 5000) warnings.push({ severity: 'warning', field: 'goodsReceipts', message: `${totalUnits.toLocaleString()} drum/bag unit identities will be generated if approved; confirm this large historical import carefully.` });
    return {
        importType: 'auto', detectedDocumentType: 'raw_material_receiving_and_gate_pass_ledger', columns: [], previewRows: [], fieldMapping: {}, validationErrors: warnings,
        extractionResult: { mode: 'structured', sheetName: detectedSheets.map((item) => item.name).join(', '), sourceSheets: detectedSheets, customer: { name: 'PRAN', entityKind: 'organization', customerType: 'cold_storage_client', phone: '', phones: [], address: '', contactName: null }, products, goodsReceipts: receipts, deliveries: [], payments: [], reconciliation: [] },
        sourceSummary: { customer: 'PRAN', products: products.length, goodsReceipts: receipts.length, deliveries: 0, payments: 0, receivedLots: totalUnits, deliveredLots: 0, inStockLots: totalUnits, totalKg, rentCharged: 0, laborCharged: 0, totalCharged: 0, paymentsReceived: 0, totalDue: 0, detectedSheets: detectedSheets.length },
        routingPlan: [
            { department: 'Customer Management', recordType: 'customer', count: 1, action: 'Match PRAN to its registered customer account' },
            { department: 'Inventory / Cold Storage', recordType: 'raw_material_receipt', count: receipts.length, action: 'Create deduplicated product batches from drum/bag receipts' },
            { department: 'Security / Logistics', recordType: 'gate_pass_reference', count: receipts.filter((item) => item.gatePassReference).length, action: 'Preserve source gate-pass and vehicle references on every receipt' }
        ]
    };
}
function extractOperationalLedger(sheet) {
    const detail = cellText(sheet, 5, 1);
    const contact = extractContact(detail);
    const customer = {
        name: cellText(sheet, 4, 1), entityKind: 'organization', customerType: 'cold_storage_client',
        phone: contact.phone, phones: contact.phones, address: contact.address, contactName: contact.proprietor, sourceText: detail
    };
    const receipts = [];
    for (let row = 1; row <= sheet.rowCount; row++) {
        if (norm(cellText(sheet, row, 1)) !== 'receiveddate') continue;
        const labels = {};
        for (let scan = row; scan <= Math.min(row + 9, sheet.rowCount); scan++) labels[norm(cellText(sheet, scan, 1))] = scan;
        const required = ['product', 'dalilno', 'totallot', 'kginperlot', 'totalkg'];
        if (!required.every((label) => labels[label])) continue;
        const externalReference = cellText(sheet, labels.dalilno, 2);
        const totalLots = number(cellValue(sheet, labels.totallot, 2));
        const rawProductName = cellText(sheet, labels.product, 2);
        if (!/^\d+\/\d{4}$/.test(externalReference) || totalLots <= 0 || !rawProductName) continue;
        const kgPerLot = number(cellValue(sheet, labels.kginperlot, 2));
        const totalKg = number(cellValue(sheet, labels.totalkg, 2)) || totalLots * kgPerLot;
        const rentRatePerKg = number(cellValue(sheet, row, 3));
        const laborRatePerLot = number(cellValue(sheet, row, 4));
        const laborAmount = number(cellValue(sheet, row, 5)) || totalLots * laborRatePerLot;
        const rentAmount = number(cellValue(sheet, row, 6)) || totalKg * rentRatePerKg;
        let blockEnd = sheet.rowCount;
        for (let scan = row + 1; scan <= sheet.rowCount; scan++) if (norm(cellText(sheet, scan, 1)) === 'receiveddate') { blockEnd = scan - 1; break; }
        let deliverySummaryRow = null, stockSummaryRow = null, deliveryDate = null, gatePassReference = null;
        for (let scan = row; scan <= blockEnd; scan++) {
            const summaryLabel = norm(cellText(sheet, scan, 6));
            if (summaryLabel.includes('totaldeliveryindalil')) deliverySummaryRow = scan;
            if (summaryLabel.includes('totalstockindalil')) stockSummaryRow = scan;
            if (!deliveryDate && number(cellValue(sheet, scan, 8)) > 0) deliveryDate = isoDate(cellValue(sheet, scan, 7));
            const possibleGatePass = cellText(sheet, scan, 9).replace(/^-/, '');
            if (number(cellValue(sheet, scan, 8)) > 0 && possibleGatePass) gatePassReference = possibleGatePass;
        }
        const deliveredQuantity = deliverySummaryRow ? number(cellValue(sheet, deliverySummaryRow, 8)) : 0;
        const reportedRemaining = stockSummaryRow ? number(cellValue(sheet, stockSummaryRow, 8)) : 0;
        const remainingQuantity = reportedRemaining || Math.max(0, totalLots - deliveredQuantity);
        const billedThroughDate = stockSummaryRow ? isoDate(cellValue(sheet, stockSummaryRow, 9)) : null;
        receipts.push({
            sourceRow: row, externalReference, receivedDate: isoDate(cellValue(sheet, row, 2)), rawProductName,
            productName: normalizeProductName(rawProductName), totalLots, kgPerLot, totalKg, unit: 'lot',
            rentRatePerKg, rentRatePerLot: rounded(kgPerLot * rentRatePerKg), laborRatePerLot,
            laborAmount: rounded(laborAmount), rentAmount: rounded(rentAmount), deliveredQuantity,
            remainingQuantity, deliveryDate, billedThroughDate, gatePassReference
        });
    }
    let paymentHeaderRow = null;
    for (let row = 1; row <= sheet.rowCount; row++) {
        const label = norm(cellText(sheet, row, 14));
        if (label === 'amountreceiveddate' || label === 'amountreceived') { paymentHeaderRow = row; break; }
    }
    const payments = [];
    if (paymentHeaderRow) {
        for (let row = paymentHeaderRow + 1; row <= sheet.rowCount; row++) {
            const amount = number(cellValue(sheet, row, 15));
            const paymentDate = isoDate(cellValue(sheet, row, 14) || cellText(sheet, row, 14));
            if (!amount || !paymentDate) continue;
            const rawReference = cellText(sheet, row, 18);
            payments.push({ sourceRow: row, paymentDate, amount, rentAmount: number(cellValue(sheet, row, 16)), laborAmount: number(cellValue(sheet, row, 17)), reference: rawReference ? `MR-${String(rawReference).replace(/^-/, '')}` : null, rawReference });
        }
    }
    const calculated = {
        receivedLots: rounded(receipts.reduce((sum, item) => sum + item.totalLots, 0)),
        totalKg: rounded(receipts.reduce((sum, item) => sum + item.totalKg, 0)),
        deliveredLots: rounded(receipts.reduce((sum, item) => sum + item.deliveredQuantity, 0)),
        inStockLots: rounded(receipts.reduce((sum, item) => sum + item.remainingQuantity, 0)),
        rentCharged: rounded(receipts.reduce((sum, item) => sum + item.rentAmount, 0)),
        laborCharged: rounded(receipts.reduce((sum, item) => sum + item.laborAmount, 0)),
        paymentsReceived: rounded(payments.reduce((sum, item) => sum + item.amount, 0))
    };
    calculated.totalCharged = rounded(calculated.rentCharged + calculated.laborCharged);
    calculated.totalDue = rounded(calculated.totalCharged - calculated.paymentsReceived);
    const reported = {
        receivedLots: number(cellValue(sheet, 8, 8)), deliveredLots: number(cellValue(sheet, 8, 9)), inStockLots: number(cellValue(sheet, 8, 10)),
        rentCharged: number(cellValue(sheet, 9, 6)), laborCharged: number(cellValue(sheet, 9, 5)), totalCharged: number(cellValue(sheet, 9, 7)),
        paymentsReceived: number(cellValue(sheet, 9, 15)), totalDue: number(cellValue(sheet, 7, 7))
    };
    const checks = Object.keys(reported).map((key) => ({ key, label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (x) => x.toUpperCase()), reported: rounded(reported[key]), calculated: rounded(calculated[key]), difference: rounded(calculated[key] - reported[key]), status: Math.abs(calculated[key] - reported[key]) < 0.01 ? 'matched' : 'mismatch' }));
    const products = [...new Set(receipts.map((item) => item.productName))].map((name) => ({ name, category: 'Cold storage goods', unit: 'lot' }));
    const warnings = [];
    if (!customer.name) warnings.push({ field: 'customer', message: 'Customer name could not be detected' });
    if (!receipts.length) warnings.push({ field: 'stock', message: 'No valid goods receipt blocks were detected' });
    checks.filter((check) => check.status === 'mismatch').forEach((check) => warnings.push({ field: check.key, message: `Workbook total does not reconcile: reported ${check.reported}, calculated ${check.calculated}` }));
    return {
        importType: 'auto', detectedDocumentType: 'customer_stock_rental_payment_ledger', columns: [], previewRows: [], fieldMapping: {}, validationErrors: warnings,
        extractionResult: { mode: 'structured', sheetName: sheet.name, customer, products, goodsReceipts: receipts, deliveries: receipts.filter((item) => item.deliveredQuantity > 0).map((item) => ({ externalReference: item.externalReference, batchExternalReference: item.externalReference, deliveryDate: item.deliveryDate, quantity: item.deliveredQuantity, gatePassReference: item.gatePassReference })), payments, reconciliation: checks },
        sourceSummary: { customer: customer.name, products: products.length, goodsReceipts: receipts.length, deliveries: receipts.filter((item) => item.deliveredQuantity > 0).length, payments: payments.length, ...calculated },
        routingPlan: [
            { department: 'Customer Management', recordType: 'customer', count: customer.name ? 1 : 0, action: 'Match or create the organization customer' },
            { department: 'Inventory / Cold Storage', recordType: 'goods_receipt', count: receipts.length, action: 'Create products, batches, goods receipts, location balances, and stock movements' },
            { department: 'Logistics / Security', recordType: 'stock_release', count: receipts.filter((item) => item.deliveredQuantity > 0).length, action: 'Record historical deliveries and gate-pass references' },
            { department: 'Accounts', recordType: 'customer_charge', count: receipts.length * 2, action: 'Post rental and labor charges and calculate customer due' },
            { department: 'Accounts', recordType: 'customer_payment', count: payments.length, action: 'Post received payments, allocate dues, and generate money receipts' }
        ]
    };
}
async function analyzeFile(file, requestedType = 'auto') {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.csv') return analyzeFlat(parseCsv(fs.readFileSync(file.path, 'utf8')), requestedType);
    if (ext === '.json') {
        const parsed = JSON.parse(fs.readFileSync(file.path, 'utf8'));
        return analyzeFlat(Array.isArray(parsed) ? parsed : parsed.rows || [], requestedType);
    }
    if (!['.xlsx', '.xlsm'].includes(ext)) throw Object.assign(new Error('Supported bulk files are CSV, JSON, XLSX, and XLSM.'), { statusCode: 400 });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file.path);
    if (!workbook.worksheets.length) throw Object.assign(new Error('The workbook has no worksheets'), { statusCode: 400 });
    const pranAnalysis = extractPranWorkbook(workbook);
    if (pranAnalysis && (requestedType === 'auto' || requestedType === 'stock_report' || requestedType === 'raw_material_report')) return pranAnalysis;
    const sheet = workbook.worksheets.find((candidate) => findLabelRow(candidate, 1, 'Received Date')) || workbook.worksheets[0];
    const looksOperational = Boolean(findLabelRow(sheet, 1, 'Received Date') && findLabelRow(sheet, 1, 'Product') && findLabelRow(sheet, 1, 'Dalil No'));
    if (looksOperational && (requestedType === 'auto' || requestedType === 'stock_report')) return extractOperationalLedger(sheet);
    const headers = sheet.getRow(1).values.slice(1).map((value) => String(value ?? '').trim());
    const rows = [];
    sheet.eachRow((row, rowNumber) => { if (rowNumber > 1 && !row.values.slice(1).every((value) => value == null || String(value).trim() === '')) rows.push(Object.fromEntries(headers.map((header, index) => [header, row.getCell(index + 1).text]))); });
    return analyzeFlat(rows, requestedType);
}

function recalculateStructuredReview(input) {
    if (!input || input.mode !== 'structured') throw Object.assign(new Error('Structured extraction is required'), { statusCode: 400 });
    const cleanText = (value, max = 300) => String(value ?? '').trim().slice(0, max);
    const customer = {
        ...input.customer,
        name: cleanText(input.customer?.name, 160), contactName: cleanText(input.customer?.contactName, 160) || null,
        phone: cleanText(input.customer?.phone, 160), address: cleanText(input.customer?.address, 500),
        entityKind: 'organization', customerType: cleanText(input.customer?.customerType, 80) || 'cold_storage_client'
    };
    customer.phones = customer.phone.match(/(?:\+?88)?01\d{9}/g) || [];
    const validationErrors = [];
    if (!customer.name) validationErrors.push({ field: 'customer.name', message: 'Customer name is required' });
    const goodsReceipts = (Array.isArray(input.goodsReceipts) ? input.goodsReceipts : []).slice(0, 10000).map((source, index) => {
        const totalLots = Math.max(0, number(source.totalLots));
        const kgPerLot = Math.max(0, number(source.kgPerLot));
        const deliveredQuantity = Math.max(0, number(source.deliveredQuantity));
        const rentRatePerKg = Math.max(0, number(source.rentRatePerKg));
        const laborRatePerLot = Math.max(0, number(source.laborRatePerLot));
        const externalReference = cleanText(source.externalReference, 120);
        const productName = cleanText(source.productName, 160);
        const receivedDate = isoDate(source.receivedDate);
        if (!externalReference) validationErrors.push({ row: index + 1, field: 'externalReference', message: 'Dalil/reference is required' });
        if (!productName) validationErrors.push({ row: index + 1, field: 'productName', message: 'Product name is required' });
        if (totalLots <= 0) validationErrors.push({ row: index + 1, field: 'totalLots', message: 'Received quantity must be greater than zero' });
        if (!Number.isInteger(totalLots)) validationErrors.push({ row: index + 1, field: 'totalLots', message: 'Lot/unit quantity must be a whole number for individual identities' });
        if (!receivedDate) validationErrors.push({ row: index + 1, field: 'receivedDate', message: 'Received date is required' });
        if (deliveredQuantity > totalLots) validationErrors.push({ row: index + 1, field: 'deliveredQuantity', message: 'Delivered quantity cannot exceed received quantity' });
        if (deliveredQuantity > 0 && !isoDate(source.deliveryDate)) validationErrors.push({ row: index + 1, field: 'deliveryDate', message: 'Delivery date is required when delivered quantity is entered' });
        return {
            ...source, externalReference, productName, receivedDate, deliveryDate: deliveredQuantity > 0 ? isoDate(source.deliveryDate) : null,
            billedThroughDate: isoDate(source.billedThroughDate), gatePassReference: cleanText(source.gatePassReference, 120) || null,
            totalLots, kgPerLot, totalKg: rounded(totalLots * kgPerLot), unit: cleanText(source.unit, 30) || 'lot',
            rentRatePerKg, rentRatePerLot: rounded(kgPerLot * rentRatePerKg), laborRatePerLot,
            laborAmount: rounded(totalLots * laborRatePerLot), rentAmount: rounded(totalLots * kgPerLot * rentRatePerKg),
            deliveredQuantity, remainingQuantity: rounded(Math.max(0, totalLots - deliveredQuantity))
        };
    });
    const duplicateReferences = goodsReceipts.map((item) => item.externalReference).filter((reference, index, all) => reference && all.indexOf(reference) !== index);
    if (duplicateReferences.length) validationErrors.push({ field: 'externalReference', message: `Duplicate references in review: ${[...new Set(duplicateReferences)].join(', ')}` });
    const payments = (Array.isArray(input.payments) ? input.payments : []).slice(0, 10000).map((source, index) => {
        const amount = Math.max(0, number(source.amount));
        const paymentDate = isoDate(source.paymentDate);
        if (amount <= 0) validationErrors.push({ row: index + 1, field: 'payment.amount', message: 'Payment amount must be greater than zero' });
        if (!paymentDate) validationErrors.push({ row: index + 1, field: 'payment.paymentDate', message: 'Payment date is required' });
        return { ...source, paymentDate, reference: cleanText(source.reference, 120) || null, amount, rentAmount: Math.max(0, number(source.rentAmount)), laborAmount: Math.max(0, number(source.laborAmount)) };
    });
    const calculated = {
        receivedLots: rounded(goodsReceipts.reduce((sum, item) => sum + item.totalLots, 0)),
        totalKg: rounded(goodsReceipts.reduce((sum, item) => sum + item.totalKg, 0)),
        deliveredLots: rounded(goodsReceipts.reduce((sum, item) => sum + item.deliveredQuantity, 0)),
        inStockLots: rounded(goodsReceipts.reduce((sum, item) => sum + item.remainingQuantity, 0)),
        rentCharged: rounded(goodsReceipts.reduce((sum, item) => sum + item.rentAmount, 0)),
        laborCharged: rounded(goodsReceipts.reduce((sum, item) => sum + item.laborAmount, 0)),
        paymentsReceived: rounded(payments.reduce((sum, item) => sum + item.amount, 0))
    };
    calculated.totalCharged = rounded(calculated.rentCharged + calculated.laborCharged);
    calculated.totalDue = rounded(calculated.totalCharged - calculated.paymentsReceived);
    if (calculated.totalDue < 0) validationErrors.push({ field: 'payments', message: 'Payments cannot be greater than detected charges' });
    const reportedByKey = Object.fromEntries((input.reconciliation || []).map((check) => [check.key, number(check.reported)]));
    const reconciliation = Object.keys(calculated).map((key) => {
        const reported = Object.prototype.hasOwnProperty.call(reportedByKey, key) ? rounded(reportedByKey[key]) : rounded(calculated[key]);
        const difference = rounded(calculated[key] - reported);
        return { key, label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase()), reported, calculated: rounded(calculated[key]), difference, status: Math.abs(difference) < 0.01 ? 'matched' : 'adjusted' };
    });
    const products = [...new Set(goodsReceipts.map((item) => item.productName).filter(Boolean))].map((name) => ({ name, category: input.products?.find((item) => item.name === name)?.category || 'Cold storage goods', unit: goodsReceipts.find((item) => item.productName === name)?.unit || 'lot' }));
    const deliveries = goodsReceipts.filter((item) => item.deliveredQuantity > 0).map((item) => ({ externalReference: item.externalReference, batchExternalReference: item.externalReference, deliveryDate: item.deliveryDate, quantity: item.deliveredQuantity, gatePassReference: item.gatePassReference }));
    const sourceSummary = { customer: customer.name, products: products.length, goodsReceipts: goodsReceipts.length, deliveries: deliveries.length, payments: payments.length, ...calculated };
    const routingPlan = [
        { department: 'Customer Management', recordType: 'customer', count: customer.name ? 1 : 0, action: 'Match registered customer by name/phone; otherwise create automatically' },
        { department: 'Inventory / Cold Storage', recordType: 'goods_receipt', count: goodsReceipts.length, action: 'Create products, batches, goods receipts, location balances, and stock movements' },
        { department: 'Logistics / Security', recordType: 'stock_release', count: deliveries.length, action: 'Record deliveries and gate-pass references' },
        { department: 'Accounts', recordType: 'customer_charge', count: goodsReceipts.length * 2, action: 'Generate rental/labor charges and customer dues automatically' },
        { department: 'Accounts', recordType: 'customer_payment', count: payments.length, action: 'Post payments, allocate imported dues, and generate money receipts' }
    ];
    return { extractionResult: { ...input, customer, products, goodsReceipts, deliveries, payments, reconciliation, editedAt: new Date().toISOString() }, sourceSummary, routingPlan, validationErrors };
}

module.exports = { analyzeFile, suggestMapping, FLAT_TARGETS, normalizeProductName, recalculateStructuredReview };
