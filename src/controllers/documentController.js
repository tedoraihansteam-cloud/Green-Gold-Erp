const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { ZipArchive } = require('archiver');
const { query } = require('../config/db');
const { buildSnapshot } = require('./dailyFinancialController');
const { renderForEntity } = require('../services/qrBarcodeService');

const ENTITY_SOURCES = {
    ACCOUNT: ['accounts', 'Account'], BUDGET: ['budgets', 'Budget'],
    COLD_STORAGE_INVOICE: ['cold_storage_invoices', 'Cold Storage Invoice'],
    DELIVERY: ['deliveries', 'Delivery'], VEHICLE: ['delivery_vehicles', 'Vehicle'],
    EXPENSE: ['expenses', 'Expense'], GATE_PASS: ['gate_passes', 'Gate Pass'],
    MACHINE_INCIDENT: ['machine_incidents', 'Machine Incident'], MACHINE: ['machines', 'Machine'],
    CUSTOMER: ['master_customers', 'Customer'], EMPLOYEE: ['master_employees', 'Employee'],
    VENDOR: ['master_vendors', 'Vendor'], PAYROLL_RUN: ['payroll_runs', 'Payroll Run'],
    PRODUCT: ['products', 'Product'], RENTAL_POLICY: ['rental_policies', 'Rental Policy'],
    SALARY_TEMPLATE: ['salary_templates', 'Salary Template'], INVOICE: ['sales_invoices', 'Sales Invoice'],
    COLD_STORAGE_CONTRACT: ['storage_contracts', 'Cold Storage Contract'],
    STORAGE_LOCATION: ['storage_locations', 'Storage Location'], WAREHOUSE: ['warehouses', 'Warehouse'],
    PRODUCT_BATCH: ['product_batches', 'Product Batch'], CUSTOMER_CHARGE: ['customer_charges', 'Customer Charge'],
    PURCHASE_ORDER: ['purchase_orders','Purchase Order'], PURCHASE_REQUISITION: ['purchase_requisitions','Purchase Requisition Slip'],
    PORTAL_REQUEST: ['portal_requests','Letter / Request Slip'], DATA_CORRECTION: ['data_correction_requests','Data Correction Request'],
    SALES_INVOICE: ['sales_invoices','Sales Invoice'], PAYROLL: ['payroll_runs','Payroll Pay Order'],
    CUSTOMER_PAYMENT: ['customer_payments', 'Customer Payment'], FINANCIAL_INVOICE:['unified_invoices','Financial Invoice'], GOODS_RECEIPT:['goods_receipts','Goods Received Note'], BILL_SUBMISSION:['bill_submissions','Bill Submission'], MONEY_RECEIPT:['financial_documents','Money Receipt'], PAYMENT_VOUCHER:['financial_documents','Payment Voucher'], APPROVED_PAYABLE_VOUCHER:['financial_documents','Approved Payable Voucher'], PAYMENT_ACCEPTANCE_VOUCHER:['financial_documents','Payment Acceptance Voucher'], TRANSFER_VOUCHER:['financial_documents','Transfer Voucher'], STOCK_RELEASE:['stock_release_documents','Stock Release Statement']
};
const ENTITY_PERMISSIONS = {
    ACCOUNT: 'ACCOUNTS_VIEW', EXPENSE: 'ACCOUNTS_VIEW', INVOICE: 'SALES_VIEW', CUSTOMER: 'SALES_VIEW',
    PRODUCT: 'INVENTORY_VIEW', WAREHOUSE: 'INVENTORY_VIEW', VENDOR: 'INVENTORY_VIEW', EMPLOYEE: 'HR_VIEW',
    PAYROLL_RUN: 'HR_VIEW', SALARY_TEMPLATE: 'HR_VIEW', BUDGET: 'BUDGET_VIEW', GATE_PASS: 'SECURITY_VIEW',
    MACHINE: 'MANUFACTURING_VIEW', MACHINE_INCIDENT: 'MANUFACTURING_VIEW', DELIVERY: 'LOGISTICS_VIEW', VEHICLE: 'LOGISTICS_VIEW',
    COLD_STORAGE_INVOICE: 'COLD_STORAGE_VIEW', COLD_STORAGE_CONTRACT: 'COLD_STORAGE_VIEW', STORAGE_LOCATION: 'COLD_STORAGE_VIEW', RENTAL_POLICY: 'COLD_STORAGE_VIEW',
    PRODUCT_BATCH:'INVENTORY_VIEW', CUSTOMER_CHARGE:'ACCOUNTS_VIEW', CUSTOMER_PAYMENT:'ACCOUNTS_VIEW', GOODS_RECEIPT:'INVENTORY_VIEW', BILL_SUBMISSION:'ACCOUNTS_VIEW', MONEY_RECEIPT:'ACCOUNTS_VIEW', PAYMENT_VOUCHER:'ACCOUNTS_VIEW', APPROVED_PAYABLE_VOUCHER:'ACCOUNTS_VIEW', PAYMENT_ACCEPTANCE_VOUCHER:'ACCOUNTS_VIEW', TRANSFER_VOUCHER:'ACCOUNTS_VIEW', STOCK_RELEASE:'INVENTORY_VIEW',
    PURCHASE_ORDER:'INVENTORY_VIEW',PURCHASE_REQUISITION:'INVENTORY_VIEW',PORTAL_REQUEST:null,DATA_CORRECTION:'USER_MANAGEMENT_VIEW',SALES_INVOICE:'SALES_VIEW',PAYROLL:'HR_VIEW'
};

function requireEntityAccess(req, entityType) {
    if(entityType==='FINANCIAL_INVOICE'){
        if(['SALES_VIEW','COLD_STORAGE_VIEW','INVENTORY_VIEW','LOGISTICS_VIEW','ACCOUNTS_VIEW'].some(code=>req.permissions.has(code)))return;
        throw Object.assign(new Error('Invoice access permission required'),{statusCode:403});
    }
    const permission = ENTITY_PERMISSIONS[entityType];
    if (permission && !req.permissions.has(permission)) throw Object.assign(new Error(`Missing required permission: ${permission}`), { statusCode: 403 });
}

function humanize(key) {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function printableValue(value) {
    if (value == null || value === '') return '-';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

async function loadEntity(entityType, businessId, companyId) {
    const source = ENTITY_SOURCES[entityType];
    if (!source) throw Object.assign(new Error('Unsupported entity type'), { statusCode: 400 });
    const { rows } = await query(`SELECT * FROM ${source[0]} WHERE business_id = $1 AND company_id = $2`, [businessId, companyId]);
    if (!rows.length) throw Object.assign(new Error('Record not found'), { statusCode: 404 });
    const row=rows[0];
    if(entityType==='PURCHASE_ORDER')row.line_items=(await query(`SELECT COALESCE(p.name,poi.item_description) item,poi.item_type,poi.unit,poi.receiving_action,poi.quantity_ordered,poi.quantity_received,poi.unit_price,poi.line_total FROM purchase_order_items poi LEFT JOIN products p ON p.id=poi.product_id WHERE poi.purchase_order_id=$1 ORDER BY poi.id`,[row.id])).rows;
    if(entityType==='PURCHASE_REQUISITION')row.requested_items=(await query(`SELECT item_type,item_description,specification,quantity,unit,estimated_unit_cost,quantity_ordered FROM purchase_requisition_items WHERE requisition_id=$1 ORDER BY id`,[row.id])).rows;
    if(entityType==='BILL_SUBMISSION')row.generated_vouchers=(await query(`SELECT business_id,document_type,amount,description,created_at FROM financial_documents WHERE source_id=$1 ORDER BY created_at`,[row.business_id])).rows;
    return { row, title: source[1] };
}

async function loadBranding(companyId){const {rows}=await query(`SELECT c.name,cp.logo_path,cp.tagline,cp.slogan,cp.phone,cp.email,cp.website,cp.registration_number,cp.tax_number,cs.address FROM companies c LEFT JOIN company_profiles cp ON cp.company_id=c.id LEFT JOIN LATERAL(SELECT address FROM company_sites WHERE company_id=c.id ORDER BY is_document_address DESC,created_at LIMIT 1) cs ON true WHERE c.id=$1`,[companyId]);return rows[0]||{name:'Green Gold ERP'};}
function startPdf(res, filename, title, subtitle,branding={}) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: title } });
    doc.pipe(res);
    doc.rect(0,0,595,112).fill('#f4f8f3');
    doc.rect(0,0,9,842).fill('#185c37');
    if(branding.logo_path&&fs.existsSync(branding.logo_path))doc.image(branding.logo_path,48,42,{fit:[42,42]});
    const brandX=branding.logo_path?98:48;
    doc.fillColor('#185c37').fontSize(18).font('Helvetica-Bold').text(branding.name||'Green Gold ERP',brandX,45,{width:165});
    if(branding.tagline||branding.slogan)doc.fillColor('#64748b').font('Helvetica').fontSize(7).text(branding.tagline||branding.slogan,brandX,69,{width:165});
    const contact=[branding.address,branding.phone,branding.email].filter(Boolean).join(' · ');
    if(contact)doc.fillColor('#64748b').font('Helvetica').fontSize(6).text(contact,48,84,{width:210});
    doc.fillColor('#1f2937').fontSize(16).text(title,270,48,{width:277,align:'right'});
    doc.fillColor('#6b7280').fontSize(9).text(subtitle || `Generated ${new Date().toISOString()}`,270,82,{width:277,align:'right'});
    doc.strokeColor('#cdd8cf').moveTo(48,108).lineTo(547,108).stroke();doc.x=48;doc.y=120;
    return doc;
}

async function addResponsibilityFooter(doc,companyId,entityType,entityId,row={}){const ids=[row.issued_by,row.created_by,row.prepared_by,row.approved_by,row.authorized_by].filter(Boolean),users=ids.length?(await query(`SELECT id,username,display_name FROM users WHERE id=ANY($1::uuid[])`,[ids])).rows:[],name=id=>users.find(u=>u.id===id)?.display_name||users.find(u=>u.id===id)?.username||null;const {rows:s}=await query(`SELECT ds.signoff_role,ds.external_name,ds.status,ds.signed_at,u.username,u.display_name FROM document_signoffs ds LEFT JOIN users u ON u.id=ds.user_id WHERE ds.company_id=$1 AND ds.entity_type=$2 AND ds.entity_id=$3`,[companyId,entityType,entityId]);const sign=role=>s.find(x=>x.signoff_role===role),signedName=role=>sign(role)?.external_name||sign(role)?.display_name||sign(role)?.username,prepared=signedName('prepared')||name(row.issued_by||row.created_by||row.prepared_by)||'System user';if(doc.y>660)doc.addPage();const y=690;doc.strokeColor('#cbd5e1').moveTo(48,y-14).lineTo(547,y-14).stroke();[['Prepared by',prepared],['Approved by',name(row.approved_by)||signedName('approved')||'Pending'],['Paid / Authorized by',signedName('paid')||name(row.authorized_by)||signedName('authorized')||'Pending'],['Received by',signedName('received')||'Pending']].forEach(([label,value],i)=>{const x=48+i*125;doc.font('Helvetica-Bold').fillColor('#185c37').fontSize(8).text(label,x,y,{width:115,align:'center'});doc.font('Helvetica').fillColor('#111827').fontSize(7).text(value,x,y+16,{width:115,align:'center'});doc.fillColor('#64748b').fontSize(6).text(value==='Pending'?'Digital approval pending':'Digitally signed',x,y+31,{width:115,align:'center'});});}

function invoiceMoney(value){return `BDT ${Number(value||0).toLocaleString('en-BD',{minimumFractionDigits:2,maximumFractionDigits:2})}`;}
function invoiceText(value,fallback='Not provided'){return value==null||String(value).trim()===''?fallback:String(value);}
function drawInvoiceTableHeader(doc,y){doc.roundedRect(42,y,511,25,3).fill('#185c37');doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff').text('ITEM / DESCRIPTION',52,y+9,{width:190}).text('BATCH',246,y+9,{width:85}).text('QTY',335,y+9,{width:55,align:'right'}).text('RATE',397,y+9,{width:70,align:'right'}).text('AMOUNT',474,y+9,{width:69,align:'right'});return y+31;}
async function invoicePdf(req,res,row,branding){
    const {rows:details}=await query(`SELECT si.*,c.business_id customer_business_id,c.name customer_name,c.phone customer_phone,c.email customer_email,c.address customer_address,c.customer_type,c.status customer_status,w.business_id warehouse_business_id,w.name warehouse_name,COALESCE(cr.original_amount-cr.paid_amount,si.total) current_outstanding,COALESCE((SELECT sum(r.original_amount-r.paid_amount) FROM customer_receivables r WHERE r.customer_id=c.id AND r.status IN('unpaid','partial') AND NOT(r.source_type='SALES_INVOICE' AND r.source_id=si.business_id)),0) previous_due FROM sales_invoices si JOIN master_customers c ON c.id=si.customer_id JOIN warehouses w ON w.id=si.warehouse_id LEFT JOIN customer_receivables cr ON cr.source_type='SALES_INVOICE' AND cr.source_id=si.business_id WHERE si.id=$1`,[row.id]);
    const invoice=details[0];
    const {rows:items}=await query(`SELECT p.business_id,p.name,p.unit,sii.quantity,sii.unit_price,sii.line_total,pb.business_id batch_business_id FROM sales_invoice_items sii JOIN products p ON p.id=sii.product_id LEFT JOIN product_batches pb ON pb.id=sii.batch_id WHERE sii.invoice_id=$1 ORDER BY p.name`,[row.id]);
    res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="INVOICE_${row.business_id}.pdf"`);
    const doc=new PDFDocument({size:'A4',margin:42,bufferPages:true,info:{Title:`Invoice ${row.business_id}`}});doc.pipe(res);
    doc.rect(0,0,595,118).fill('#f4f8f3');doc.rect(0,0,9,842).fill('#185c37');
    if(branding.logo_path&&fs.existsSync(branding.logo_path))doc.image(branding.logo_path,42,28,{fit:[52,52]});const brandX=branding.logo_path&&fs.existsSync(branding.logo_path)?106:42;
    doc.font('Helvetica-Bold').fontSize(19).fillColor('#185c37').text(branding.name||'Green Gold ERP',brandX,28,{width:255});
    if(branding.tagline||branding.slogan)doc.font('Helvetica-Oblique').fontSize(8).fillColor('#597061').text(branding.tagline||branding.slogan,brandX,55,{width:255});
    const companyLines=[branding.address,[branding.phone,branding.email].filter(Boolean).join('  |  '),branding.website,[branding.registration_number&&`Registration: ${branding.registration_number}`,branding.tax_number&&`Tax ID: ${branding.tax_number}`].filter(Boolean).join('  |  ')].filter(Boolean);doc.font('Helvetica').fontSize(6.8).fillColor('#405247').text(companyLines.join('\n'),brandX,70,{width:275,lineGap:1});
    doc.font('Helvetica-Bold').fontSize(24).fillColor('#1f2937').text('INVOICE',375,28,{width:178,align:'right'});doc.font('Helvetica-Bold').fontSize(9).fillColor('#185c37').text(row.business_id,375,60,{width:178,align:'right'});doc.font('Helvetica').fontSize(7).fillColor('#64748b').text(`Issued: ${new Date(invoice.created_at).toLocaleDateString('en-GB')}\nDue: ${invoice.due_date?new Date(invoice.due_date).toLocaleDateString('en-GB'):'On receipt'}\nStatus: ${String(invoice.payment_status||invoice.status).toUpperCase()}`,375,77,{width:178,align:'right',lineGap:2});
    doc.roundedRect(42,137,310,112,6).fillAndStroke('#fbfcfa','#d7e2d7');doc.font('Helvetica-Bold').fontSize(9).fillColor('#185c37').text('BILL TO',56,151);doc.font('Helvetica-Bold').fontSize(13).fillColor('#111827').text(invoiceText(invoice.customer_name),56,171,{width:278});doc.font('Helvetica').fontSize(7.5).fillColor('#374151').text(`Customer ID: ${invoice.customer_business_id}\nType: ${invoiceText(invoice.customer_type,'Customer')}\nAddress: ${invoiceText(invoice.customer_address)}\nPhone: ${invoiceText(invoice.customer_phone)}\nEmail: ${invoiceText(invoice.customer_email)}`,56,194,{width:278,lineGap:2});
    doc.roundedRect(365,137,188,112,6).fillAndStroke('#ffffff','#d7e2d7');doc.font('Helvetica-Bold').fontSize(8).fillColor('#185c37').text('INVOICE DETAILS',378,151);doc.font('Helvetica').fontSize(7.5).fillColor('#374151').text(`Warehouse\n${invoice.warehouse_business_id} - ${invoice.warehouse_name}\n\nPayment status\n${String(invoice.payment_status||'due').toUpperCase()}`,378,173,{width:160,lineGap:2});
    let y=drawInvoiceTableHeader(doc,270);
    for(const item of items){if(y>575){doc.addPage();doc.rect(0,0,9,842).fill('#185c37');doc.font('Helvetica-Bold').fontSize(12).fillColor('#185c37').text(`${branding.name||'Green Gold ERP'} - Invoice ${row.business_id}`,42,42,{width:511});y=drawInvoiceTableHeader(doc,72);}const rowHeight=30;doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827').text(`${item.business_id} - ${item.name}`,52,y+3,{width:186});doc.font('Helvetica').fontSize(6.5).fillColor('#64748b').text(item.unit||'',52,y+15,{width:186});doc.fontSize(7).fillColor('#374151').text(item.batch_business_id||'-',246,y+7,{width:85}).text(Number(item.quantity).toLocaleString(),335,y+7,{width:55,align:'right'}).text(invoiceMoney(item.unit_price).replace('BDT ',''),397,y+7,{width:70,align:'right'}).font('Helvetica-Bold').text(invoiceMoney(item.line_total).replace('BDT ',''),474,y+7,{width:69,align:'right'});doc.strokeColor('#e5e7eb').moveTo(42,y+rowHeight-2).lineTo(553,y+rowHeight-2).stroke();y+=rowHeight;}
    if(y>485){doc.addPage();doc.rect(0,0,9,842).fill('#185c37');doc.font('Helvetica-Bold').fontSize(12).fillColor('#185c37').text(`${branding.name||'Green Gold ERP'} - Invoice ${row.business_id}`,42,42,{width:511});y=82;}
    if(invoice.notes){doc.font('Helvetica-Bold').fontSize(8).fillColor('#185c37').text('NOTES',42,y+12);doc.font('Helvetica').fontSize(7).fillColor('#4b5563').text(invoice.notes,42,y+27,{width:285});}
    const totalsY=y+8;doc.roundedRect(350,totalsY,203,118,5).fillAndStroke('#f8faf8','#d7e2d7');const totalRows=[['Subtotal',invoice.subtotal],['Discount',-Number(invoice.discount||0)],['Tax',invoice.tax],['Previous due',invoice.previous_due],['TOTAL PAYABLE',Number(invoice.current_outstanding)+Number(invoice.previous_due)]];totalRows.forEach(([label,value],index)=>{const ty=totalsY+12+index*19;doc.font(index===4?'Helvetica-Bold':'Helvetica').fontSize(index===4?9:7.5).fillColor(index===4?'#185c37':'#374151').text(label,364,ty,{width:85}).text(invoiceMoney(value),447,ty,{width:93,align:'right'});if(index===3)doc.strokeColor('#b8cab9').moveTo(364,ty+16).lineTo(540,ty+16).stroke();});
    const invoiceCodes=await renderForEntity('INVOICE',row.business_id);doc.image(invoiceCodes.qrPng,42,totalsY+52,{width:62});doc.font('Helvetica').fontSize(6.5).fillColor('#64748b').text('Scan to verify invoice',108,totalsY+75,{width:120});
    doc.y=Math.min(650,totalsY+132);await addResponsibilityFooter(doc,req.user.company_id,'INVOICE',row.business_id,row);
    const pages=doc.bufferedPageRange();for(let i=0;i<pages.count;i++){doc.switchToPage(i);doc.font('Helvetica').fontSize(6).fillColor('#94a3b8').text(`Page ${i+1} of ${pages.count}`,480,790,{width:70,align:'right',lineBreak:false});}doc.end();
}

async function financialInvoicePdf(req,res,row,branding){
    const {rows}=await query(`SELECT ui.*,c.business_id customer_business_id,c.name customer_name,c.phone,c.email,c.address,
      COALESCE((SELECT sum(cp.amount) FROM customer_payments cp WHERE cp.customer_id=ui.customer_id),0) total_paid,
      COALESCE((SELECT sum(cr.original_amount-cr.paid_amount) FROM customer_receivables cr WHERE cr.customer_id=ui.customer_id AND cr.status IN('unpaid','partial')),0) current_due,
      COALESCE((SELECT sum(gr.received_quantity) FROM goods_receipts gr WHERE gr.customer_id=ui.customer_id),0) total_received,
      COALESCE((SELECT sum(pb.available_quantity) FROM product_batches pb WHERE pb.owner_customer_id=ui.customer_id),0) total_stock,
      COALESCE((SELECT count(*) FROM deliveries d WHERE d.customer_id=ui.customer_id AND d.status<>'cancelled'),0) total_deliveries,
      COALESCE((SELECT sum(csi.total) FROM cold_storage_invoices csi JOIN storage_contracts sc ON sc.id=csi.contract_id WHERE sc.customer_id=ui.customer_id AND csi.status<>'cancelled'),0) total_rent,
      COALESCE((SELECT sum(u2.current_total) FROM unified_invoices u2 WHERE u2.customer_id=ui.customer_id AND u2.invoice_type='RENTAL_CONTRACT'),0) total_contract_value
      FROM unified_invoices ui LEFT JOIN master_customers c ON c.id=ui.customer_id WHERE ui.id=$1`,[row.id]);
    const x=rows[0];res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="${x.business_id}.pdf"`);
    const doc=new PDFDocument({size:'A4',margin:42,bufferPages:true,info:{Title:`Financial Invoice ${x.business_id}`}});doc.pipe(res);
    if(branding.logo_path&&fs.existsSync(branding.logo_path))doc.image(branding.logo_path,42,38,{fit:[45,45]});doc.font('Helvetica-Bold').fillColor('#185c37').fontSize(18).text(branding.name||'Green Gold ERP',98,42,{width:220});doc.fontSize(17).fillColor('#111827').text('FINANCIAL INVOICE',330,42,{width:220,align:'right'});doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(`${x.business_id}\nIssued ${new Date(x.issued_at).toLocaleDateString('en-GB')}`,330,68,{width:220,align:'right'});doc.strokeColor('#d1d5db').moveTo(42,105).lineTo(553,105).stroke();
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#185c37').text('BILLED TO',42,122).text('INVOICE DETAILS',330,122);doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(x.customer_name||'Company stock',42,142).font('Helvetica').fontSize(8).fillColor('#4b5563').text([x.customer_business_id,x.phone,x.email,x.address].filter(Boolean).join('\n'),42,160,{width:245});doc.font('Helvetica').fontSize(8).fillColor('#111827').text(`Type: ${x.invoice_type.replace(/_/g,' ')}\nSource: ${x.source_id}\nStatus: ${x.status}`,330,142,{width:220});
    let y=225;doc.roundedRect(42,y,511,29,4).fill('#185c37');doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff').text('DESCRIPTION',54,y+10,{width:275}).text('AMOUNT',425,y+10,{width:112,align:'right'});y+=39;doc.font('Helvetica').fillColor('#111827').fontSize(9).text(`${x.invoice_type.replace(/_/g,' ')} — ${x.source_id}`,54,y,{width:350}).font('Helvetica-Bold').text(invoiceMoney(x.current_total),425,y,{width:112,align:'right'});y+=38;
    const totals=[['Previous total due',x.previous_due_snapshot],['Current invoice',x.financial_impact],['TOTAL PAYABLE AT ISSUE',x.total_payable_snapshot],['Total paid to date',x.total_paid],['CURRENT TOTAL DUE',x.current_due]];doc.roundedRect(300,y,253,128,5).fillAndStroke('#f8faf8','#d7e2d7');totals.forEach(([label,value],i)=>{const yy=y+12+i*22;doc.font(i===2||i===4?'Helvetica-Bold':'Helvetica').fontSize(i===2||i===4?9:8).fillColor(i===2||i===4?'#185c37':'#374151').text(label,315,yy,{width:120}).text(invoiceMoney(value),430,yy,{width:108,align:'right'});});
    y+=155;doc.font('Helvetica-Bold').fontSize(11).fillColor('#185c37').text('CUSTOMER / ORGANIZATION HISTORY',42,y);y+=25;const stats=[['Total goods received',Number(x.total_received).toLocaleString()],['Current total stock',Number(x.total_stock).toLocaleString()],['Total deliveries',Number(x.total_deliveries).toLocaleString()],['Total rent billed',invoiceMoney(x.total_rent)],['Rental contract value',invoiceMoney(x.total_contract_value)],['Lifetime payments',invoiceMoney(x.total_paid)]];stats.forEach(([label,value],i)=>{const col=i%2,rowNo=Math.floor(i/2),xx=42+col*255,yy=y+rowNo*46;doc.roundedRect(xx,yy,240,37,4).fillAndStroke('#f8faf8','#e5e7eb');doc.font('Helvetica').fontSize(7).fillColor('#64748b').text(label,xx+10,yy+7,{width:110});doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827').text(value,xx+120,yy+12,{width:105,align:'right'});});
    doc.y=y+155;const codes=await renderForEntity('FINANCIAL_INVOICE',x.business_id);doc.image(codes.qrPng,42,610,{width:60});doc.font('Helvetica').fontSize(7).fillColor('#64748b').text('Scan to verify this financial invoice',110,630,{width:160});await addResponsibilityFooter(doc,req.user.company_id,'FINANCIAL_INVOICE',x.business_id,row);doc.end();
}

async function financialInvoiceLines(x){
    if(x.source_type==='RENT_COLLECTION_SESSION'){const {rows}=await query(`SELECT l.line_type product_name,l.description category,'item' unit,NULL batch_business_id,1 received_quantity,1 current_quantity,l.amount rate,l.amount rent_amount,0 labor_amount,0 service_amount,l.amount line_total,'Customer account' location_name,'collection' billing_cycle,1 billed_cycles FROM rent_collection_invoice_lines l JOIN rent_collection_invoices r ON r.id=l.invoice_id WHERE r.business_id=$1 ORDER BY l.id`,[x.source_id]);const commitment=(await query(`SELECT commitment_amount,commitment_date,commitment_notes FROM rent_collection_invoices WHERE business_id=$1`,[x.source_id])).rows[0];if(commitment?.commitment_date)rows.push({product_name:'PAYMENT COMMITMENT',category:`Committed ${invoiceMoney(commitment.commitment_amount||0)} on ${new Date(commitment.commitment_date).toLocaleDateString('en-GB')} - ${commitment.commitment_notes||'No remarks'}`,unit:'commitment',received_quantity:1,current_quantity:1,rate:0,rent_amount:0,labor_amount:0,service_amount:0,line_total:0,location_name:'Customer commitment',billing_cycle:'commitment',billed_cycles:1});return rows;}
    if(x.source_type==='BATCH_RENT'){const batchId=String(x.source_id).split(':')[0];return (await query(`SELECT p.name product_name,p.category,p.unit,pb.business_id batch_business_id,pb.received_quantity,pb.available_quantity current_quantity,pb.rent_per_unit_per_cycle rate,ui.current_total rent_amount,COALESCE(gr.labor_amount,0) labor_amount,COALESCE(gr.service_amount,0) service_amount,ui.current_total line_total,COALESCE(string_agg(sl.name,' / ' ORDER BY sl.name) FILTER(WHERE blb.quantity>0),'Delivered / released') location_name,pb.billing_cycle,1 billed_cycles FROM product_batches pb JOIN products p ON p.id=pb.product_id JOIN unified_invoices ui ON ui.business_id=$2 LEFT JOIN goods_receipts gr ON gr.batch_id=pb.id LEFT JOIN batch_location_balances blb ON blb.batch_id=pb.id LEFT JOIN storage_locations sl ON sl.id=blb.location_id WHERE pb.business_id=$1 GROUP BY pb.id,p.id,gr.id,ui.id`,[batchId,x.business_id])).rows;}
    if(x.invoice_type==='SALES_INVOICE'||x.invoice_type==='DELIVERY_INVOICE'){
        let source=x.source_id;if(x.invoice_type==='DELIVERY_INVOICE')source=(await query(`SELECT si.business_id FROM deliveries d LEFT JOIN sales_invoices si ON si.id=d.invoice_id WHERE d.business_id=$1`,[x.source_id])).rows[0]?.business_id;if(!source)return[];
        return (await query(`SELECT p.name product_name,p.category,p.unit,pb.business_id batch_business_id,sii.quantity received_quantity,COALESCE(pb.available_quantity,0) current_quantity,sii.unit_price rate,0 rent_amount,0 labor_amount,0 service_amount,sii.line_total line_total,COALESCE(string_agg(sl.name,' / ' ORDER BY sl.name) FILTER(WHERE blb.quantity>0),'Not assigned') location_name,'one-time' billing_cycle,1 billed_cycles FROM sales_invoice_items sii JOIN sales_invoices si ON si.id=sii.invoice_id JOIN products p ON p.id=sii.product_id LEFT JOIN product_batches pb ON pb.id=sii.batch_id LEFT JOIN batch_location_balances blb ON blb.batch_id=pb.id LEFT JOIN storage_locations sl ON sl.id=blb.location_id WHERE si.business_id=$1 GROUP BY sii.id,p.id,pb.id`,[source])).rows;
    }
    if(x.invoice_type==='GOODS_RECEIVING_INVOICE')return (await query(`SELECT p.name product_name,p.category,p.unit,pb.business_id batch_business_id,gr.received_quantity,pb.available_quantity current_quantity,gr.rent_rate rate,pb.available_quantity*gr.rent_rate rent_amount,gr.labor_amount,gr.service_amount,pb.available_quantity*gr.rent_rate+gr.labor_amount+gr.service_amount line_total,COALESCE(string_agg(sl.name,' / ' ORDER BY sl.name) FILTER(WHERE blb.quantity>0),w.name) location_name,gr.billing_cycle,1 billed_cycles FROM goods_receipts gr JOIN product_batches pb ON pb.id=gr.batch_id JOIN products p ON p.id=pb.product_id JOIN warehouses w ON w.id=gr.warehouse_id LEFT JOIN batch_location_balances blb ON blb.batch_id=pb.id LEFT JOIN storage_locations sl ON sl.id=blb.location_id WHERE gr.business_id=$1 GROUP BY gr.id,p.id,pb.id,w.id`,[x.source_id])).rows;
    const contractSql=x.invoice_type==='RENT_COLLECTION_INVOICE'?`SELECT sc.id,sc.customer_id,csi.rate_used rate,csi.billed_cycles FROM cold_storage_invoices csi JOIN storage_contracts sc ON sc.id=csi.contract_id WHERE csi.business_id=$1`:`SELECT sc.id,sc.customer_id,rp.rate_per_unit_per_cycle rate,rp.min_billing_cycles billed_cycles FROM storage_contracts sc JOIN rental_policies rp ON rp.id=sc.rental_policy_id WHERE sc.business_id=$1`;
    const c=(await query(contractSql,[x.source_id])).rows[0];if(!c)return[];
    let result=(await query(`SELECT p.name product_name,p.category,p.unit,pb.business_id batch_business_id,pb.received_quantity,pb.available_quantity current_quantity,$2::numeric rate,pb.available_quantity*$2::numeric*$3::numeric rent_amount,COALESCE(gr.labor_amount,0) labor_amount,COALESCE(gr.service_amount,0) service_amount,pb.available_quantity*$2::numeric*$3::numeric+COALESCE(gr.labor_amount,0)+COALESCE(gr.service_amount,0) line_total,COALESCE(string_agg(sl.name,' / ' ORDER BY sl.name) FILTER(WHERE blb.quantity>0),'Not assigned') location_name,COALESCE(pb.billing_cycle,'monthly') billing_cycle,$3::int billed_cycles FROM product_batches pb JOIN products p ON p.id=pb.product_id LEFT JOIN goods_receipts gr ON gr.batch_id=pb.id LEFT JOIN batch_location_balances blb ON blb.batch_id=pb.id LEFT JOIN storage_locations sl ON sl.id=blb.location_id WHERE pb.contract_id=$1 GROUP BY pb.id,p.id,gr.id`,[c.id,c.rate,c.billed_cycles])).rows;
    if(!result.length&&x.invoice_type==='RENT_COLLECTION_INVOICE')result=(await query(`SELECT p.name product_name,p.category,p.unit,pb.business_id batch_business_id,pb.received_quantity,pb.available_quantity current_quantity,$2::numeric rate,pb.available_quantity*$2::numeric*$3::numeric rent_amount,COALESCE(gr.labor_amount,0) labor_amount,COALESCE(gr.service_amount,0) service_amount,pb.available_quantity*$2::numeric*$3::numeric+COALESCE(gr.labor_amount,0)+COALESCE(gr.service_amount,0) line_total,COALESCE(string_agg(sl.name,' / ' ORDER BY sl.name) FILTER(WHERE blb.quantity>0),'Not assigned') location_name,COALESCE(pb.billing_cycle,'monthly') billing_cycle,$3::int billed_cycles FROM product_batches pb JOIN products p ON p.id=pb.product_id LEFT JOIN goods_receipts gr ON gr.batch_id=pb.id LEFT JOIN batch_location_balances blb ON blb.batch_id=pb.id LEFT JOIN storage_locations sl ON sl.id=blb.location_id WHERE pb.owner_customer_id=$1 GROUP BY pb.id,p.id,gr.id`,[c.customer_id,c.rate,c.billed_cycles])).rows;
    return result;
}

async function financialInvoiceIssuer(x){
    const authority={SALES_INVOICE:'Sales and Accounts',RENT_COLLECTION_INVOICE:'Accounts and Cold Storage Operations',GOODS_RECEIVING_INVOICE:'Inventory and Cold Storage Operations',RENTAL_CONTRACT:'Cold Storage Administration',DELIVERY_INVOICE:'Logistics and Accounts',CUSTOMER_PAYMENT_RECEIPT:'Accounts and Finance'}[x.invoice_type]||'Authorized Finance Office';
    let branch=null;
    if(x.invoice_type==='SALES_INVOICE')branch=(await query(`SELECT COALESCE(b.name,w.name) name,COALESCE(b.address,w.location_notes) address FROM sales_invoices si JOIN warehouses w ON w.id=si.warehouse_id LEFT JOIN branches b ON b.id=w.branch_id WHERE si.business_id=$1`,[x.source_id])).rows[0];
    else if(x.invoice_type==='GOODS_RECEIVING_INVOICE')branch=(await query(`SELECT COALESCE(b.name,w.name) name,COALESCE(b.address,w.location_notes) address FROM goods_receipts gr JOIN warehouses w ON w.id=gr.warehouse_id LEFT JOIN branches b ON b.id=w.branch_id WHERE gr.business_id=$1`,[x.source_id])).rows[0];
    else if(x.invoice_type==='DELIVERY_INVOICE')branch=(await query(`SELECT COALESCE(b.name,w.name) name,COALESCE(b.address,w.location_notes) address FROM deliveries d LEFT JOIN sales_invoices si ON si.id=d.invoice_id LEFT JOIN warehouses w ON w.id=si.warehouse_id LEFT JOIN branches b ON b.id=w.branch_id WHERE d.business_id=$1`,[x.source_id])).rows[0];
    else if(x.invoice_type==='RENT_COLLECTION_INVOICE'&&x.source_type!=='RENT_COLLECTION_SESSION')branch=(await query(`SELECT COALESCE(b.name,w.name) name,COALESCE(b.address,w.location_notes) address,sl.name location_name FROM cold_storage_invoices csi JOIN storage_contracts sc ON sc.id=csi.contract_id JOIN storage_locations sl ON sl.id=sc.storage_location_id JOIN warehouses w ON w.id=sl.warehouse_id LEFT JOIN branches b ON b.id=w.branch_id WHERE csi.business_id=$1`,[x.source_id])).rows[0];
    else if(x.invoice_type==='RENTAL_CONTRACT')branch=(await query(`SELECT COALESCE(b.name,w.name) name,COALESCE(b.address,w.location_notes) address,sl.name location_name FROM storage_contracts sc JOIN storage_locations sl ON sl.id=sc.storage_location_id JOIN warehouses w ON w.id=sl.warehouse_id LEFT JOIN branches b ON b.id=w.branch_id WHERE sc.business_id=$1`,[x.source_id])).rows[0];
    return {authority,branchName:[branch?.name,branch?.location_name].filter(Boolean).join(' - ')||'Head Office',branchAddress:branch?.address||null};
}

async function financialInvoicePdfV2(req,res,row,branding){
    const {rows}=await query(`SELECT ui.*,c.business_id customer_business_id,c.name customer_name,c.phone,c.email,c.address,COALESCE((SELECT sum(cp.amount) FROM customer_payments cp WHERE cp.customer_id=ui.customer_id),0) total_paid,COALESCE((SELECT sum(cr.original_amount-cr.paid_amount) FROM customer_receivables cr WHERE cr.customer_id=ui.customer_id AND cr.status IN('unpaid','partial')),0) current_due,COALESCE((SELECT sum(gr.received_quantity) FROM goods_receipts gr WHERE gr.customer_id=ui.customer_id),0) total_received,COALESCE((SELECT sum(pb.available_quantity) FROM product_batches pb WHERE pb.owner_customer_id=ui.customer_id),0) total_stock,COALESCE((SELECT count(*) FROM deliveries d WHERE d.customer_id=ui.customer_id AND d.status<>'cancelled'),0) total_deliveries,COALESCE((SELECT sum(csi.total) FROM cold_storage_invoices csi JOIN storage_contracts sc ON sc.id=csi.contract_id WHERE sc.customer_id=ui.customer_id AND csi.status<>'cancelled'),0) total_rent,COALESCE((SELECT sum(u2.current_total) FROM unified_invoices u2 WHERE u2.customer_id=ui.customer_id AND u2.invoice_type='RENTAL_CONTRACT'),0) total_contract_value FROM unified_invoices ui LEFT JOIN master_customers c ON c.id=ui.customer_id WHERE ui.id=$1`,[row.id]);
    const x=rows[0],items=await financialInvoiceLines(rows[0]),issuer=await financialInvoiceIssuer(rows[0]);const linkedPayments=x.invoice_type==='RENT_COLLECTION_INVOICE'?(x.source_type==='RENT_COLLECTION_SESSION'?(await query(`SELECT cp.business_id,cp.amount,cp.payment_date,fd.business_id voucher_business_id FROM customer_payments cp JOIN rent_collection_invoices r ON r.customer_id=cp.customer_id LEFT JOIN financial_documents fd ON fd.source_type='RENT_COLLECTION' AND fd.source_id=r.business_id AND fd.document_type='MONEY_RECEIPT' WHERE r.business_id=$1 AND cp.notes LIKE '%'||r.business_id||'%' ORDER BY cp.payment_date`,[x.source_id])).rows:(await query(`SELECT cp.business_id,pa.amount,cp.payment_date,fd.business_id voucher_business_id FROM customer_receivables cr JOIN customer_payment_allocations pa ON pa.receivable_id=cr.id JOIN customer_payments cp ON cp.id=pa.payment_id LEFT JOIN financial_documents fd ON fd.source_type='CUSTOMER_PAYMENT' AND fd.source_id=cp.business_id AND fd.document_type='MONEY_RECEIPT' WHERE cr.source_id=$1 ORDER BY cp.payment_date`,[x.source_id])).rows):[];res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="${x.business_id}.pdf"`);const doc=new PDFDocument({size:'A4',margin:42,bufferPages:true,info:{Title:`Invoice ${x.business_id}`}});doc.pipe(res);
    const title={SALES_INVOICE:'SALES INVOICE',RENT_COLLECTION_INVOICE:'RENT COLLECTION INVOICE',GOODS_RECEIVING_INVOICE:'GOODS RECEIVING INVOICE',RENTAL_CONTRACT:'RENTAL CONTRACT INVOICE',DELIVERY_INVOICE:'DELIVERY INVOICE',CUSTOMER_PAYMENT_RECEIPT:'CUSTOMER PAYMENT RECEIPT'}[x.invoice_type]||'FINANCIAL INVOICE';
    const pageHead=()=>{if(branding.logo_path&&fs.existsSync(branding.logo_path))doc.image(branding.logo_path,42,34,{fit:[42,42]});const left=branding.logo_path?92:42;doc.font('Helvetica-Bold').fillColor('#185c37').fontSize(11).text(branding.name||'Green Gold ERP',left,36,{width:275});doc.font('Helvetica').fillColor('#26372c').fontSize(6.7).text(`Issuing branch: ${issuer.branchName}\nIssuing authority: ${issuer.authority}\n${issuer.branchAddress||branding.address||'Address configured by company'}\nPhone: ${branding.phone||'-'} | Email: ${branding.email||'-'}\n${[branding.website&&`Website: ${branding.website}`,branding.registration_number&&`Registration: ${branding.registration_number}`,branding.tax_number&&`BIN/VAT: ${branding.tax_number}`].filter(Boolean).join(' | ')}`,left,52,{width:290,lineGap:1});doc.font('Helvetica-Bold').fontSize(15).fillColor('#111827').text(title,355,40,{width:198,align:'right'});doc.font('Helvetica').fontSize(7).fillColor('#64748b').text('Original customer copy',355,69,{width:198,align:'right'});doc.strokeColor('#d1d5db').moveTo(42,108).lineTo(553,108).stroke();};pageHead();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#185c37').text('BILLED TO',42,122).text('INVOICE INFORMATION',320,122);doc.fontSize(10).fillColor('#111827').text(x.customer_name||'Company stock',42,142).font('Helvetica').fontSize(7.5).fillColor('#374151').text([x.customer_business_id,x.phone,x.email,x.address].filter(Boolean).join('\n'),42,158,{width:245}).text(`Invoice: ${x.business_id}\nType: ${x.invoice_type.replace(/_/g,' ')}\nSource: ${x.source_id}\nIssued: ${new Date(x.issued_at).toLocaleDateString('en-GB')}\nStatus: ${x.status}`,320,142,{width:230});
    let y=221;const tableHead=()=>{doc.rect(42,y,511,27).fill('#185c37');[['PRODUCT / BATCH',48,115],['LOCATION',168,90],['QTY / UNIT',263,65],['RENT RATE',333,65],['CHARGES',403,70],['TOTAL',478,69]].forEach(([t,xx,w])=>doc.font('Helvetica-Bold').fontSize(6).fillColor('#fff').text(t,xx,y+9,{width:w,align:t==='TOTAL'?'right':'left'}));y+=27;};tableHead();
    const shown=items.length?items:[{product_name:x.invoice_type.replace(/_/g,' '),category:'Financial record',unit:'unit',received_quantity:1,current_quantity:1,line_total:x.current_total,location_name:'Not applicable'}];for(const l of shown){if(y>530){doc.addPage();y=60;tableHead();}doc.rect(42,y,511,50).fillAndStroke('#f8faf8','#d7e2d7');doc.font('Helvetica-Bold').fontSize(7.2).fillColor('#111827').text(l.product_name||'Product',48,y+6,{width:112}).font('Helvetica').fontSize(5.8).fillColor('#64748b').text(`${l.category||''}\n${l.batch_business_id||'No batch'}`,48,y+20,{width:112}).fontSize(6.2).fillColor('#374151').text(l.location_name||'Not assigned',168,y+8,{width:88}).text(`Received: ${Number(l.received_quantity||0).toLocaleString()}\nIn store: ${Number(l.current_quantity||0).toLocaleString()} ${l.unit||''}`,263,y+8,{width:64}).text(`${invoiceMoney(l.rate||0)} / ${l.unit||'unit'}\n${l.billing_cycle||'cycle'} x ${l.billed_cycles||1}`,333,y+8,{width:64}).text(`Rent ${invoiceMoney(l.rent_amount||0)}\nLabor ${invoiceMoney(l.labor_amount||0)}\nService ${invoiceMoney(l.service_amount||0)}`,403,y+5,{width:69}).font('Helvetica-Bold').text(invoiceMoney(l.line_total||0),478,y+18,{width:69,align:'right'});y+=50;}
    y+=12;const codes=await renderForEntity('FINANCIAL_INVOICE',x.business_id);doc.image(codes.qrPng,48,y+10,{width:65});doc.image(codes.barcodePng,120,y+35,{fit:[160,45]});const totals=[['Current document total',x.current_total],['Previous total due',x.previous_due_snapshot],['Current financial impact',x.financial_impact],['TOTAL PAYABLE AT ISSUE',x.total_payable_snapshot],['Total paid to date',x.total_paid],['CURRENT TOTAL DUE',x.current_due]];doc.roundedRect(300,y,253,143,5).fillAndStroke('#f8faf8','#d7e2d7');totals.forEach(([label,value],i)=>{const yy=y+10+i*21;doc.font(i===3||i===5?'Helvetica-Bold':'Helvetica').fontSize(7.5).fillColor(i===3||i===5?'#185c37':'#374151').text(label,314,yy,{width:125}).text(invoiceMoney(value),433,yy,{width:105,align:'right'});});
    doc.addPage();doc.font('Helvetica-Bold').fontSize(14).fillColor('#185c37').text('PRODUCT IDENTIFIERS AND CUSTOMER ACCOUNT HISTORY',42,48);y=82;for(const l of shown.filter(v=>v.batch_business_id)){if(y>490){doc.addPage();y=55;}const bc=await renderForEntity('PRODUCT_BATCH',l.batch_business_id);doc.roundedRect(42,y,511,70,4).fillAndStroke('#f8faf8','#d7e2d7');doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827').text(l.product_name,54,y+9,{width:280}).font('Helvetica').fontSize(7).fillColor('#374151').text(`${l.category||''} - ${l.batch_business_id}\nUnit: ${l.unit||'-'} - Monthly/cycle rent: ${invoiceMoney(l.rate||0)} per ${l.unit||'unit'}\nStored at: ${l.location_name||'Not assigned'}`,54,y+25,{width:290});doc.image(bc.barcodePng,365,y+13,{fit:[170,44]});y+=80;}
    if(linkedPayments.length){if(y>500){doc.addPage();y=55;}doc.font('Helvetica-Bold').fontSize(10).fillColor('#185c37').text('LINKED MONEY RECEIPTS',42,y);y+=20;linkedPayments.forEach(p=>{doc.font('Helvetica').fontSize(8).fillColor('#111827').text(`${new Date(p.payment_date).toLocaleDateString('en-GB')}  Payment ${p.business_id}  Money receipt ${p.voucher_business_id||'-'}`,48,y,{width:390}).font('Helvetica-Bold').text(invoiceMoney(p.amount),445,y,{width:95,align:'right'});y+=18;});y+=12;}if(y>510){doc.addPage();y=55;}doc.font('Helvetica-Bold').fontSize(10).fillColor('#185c37').text('CONSOLIDATED CUSTOMER / ORGANIZATION HISTORY',42,y);y+=23;const stats=[['Total goods received',Number(x.total_received).toLocaleString()],['Current stock in store',Number(x.total_stock).toLocaleString()],['Total completed deliveries',Number(x.total_deliveries).toLocaleString()],['Total rent billed to date',invoiceMoney(x.total_rent)],['Total rental contract value',invoiceMoney(x.total_contract_value)],['Total paid to date',invoiceMoney(x.total_paid)],['Current total due',invoiceMoney(x.current_due)]];stats.forEach(([label,value],i)=>{doc.rect(42,y+i*30,511,30).fillAndStroke(i%2?'#fff':'#f8faf8','#d7e2d7');doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827').text(label,54,y+10+i*30,{width:260}).font('Helvetica').text(value,330,y+10+i*30,{width:210,align:'right'});});doc.y=y+stats.length*30+20;await addResponsibilityFooter(doc,req.user.company_id,'FINANCIAL_INVOICE',x.business_id,row);const pages=doc.bufferedPageRange();for(let i=0;i<pages.count;i++){doc.switchToPage(i);doc.font('Helvetica').fontSize(6).fillColor('#94a3b8').text(`Page ${i+1} of ${pages.count}`,480,790,{width:70,align:'right',lineBreak:false});}doc.end();
}

async function entityPdf(req, res) {
    const entityType = req.params.entityType.toUpperCase();
    requireEntityAccess(req, entityType);
    const { row, title } = await loadEntity(entityType, req.params.businessId, req.user.company_id);
    const branding=await loadBranding(req.user.company_id);if(entityType==='INVOICE'||entityType==='SALES_INVOICE')return invoicePdf(req,res,row,branding);if(entityType==='FINANCIAL_INVOICE')return financialInvoicePdfV2(req,res,row,branding);
    res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="${entityType}_${row.business_id}.pdf"`);
    const doc=new PDFDocument({size:'A4',margin:42,bufferPages:true,info:{Title:`${title} ${row.business_id}`}});doc.pipe(res);
    const newPage=()=>{doc.rect(0,0,595,118).fill('#f4f8f3');doc.rect(0,0,9,842).fill('#185c37');if(branding.logo_path&&fs.existsSync(branding.logo_path))doc.image(branding.logo_path,42,28,{fit:[52,52]});const bx=branding.logo_path&&fs.existsSync(branding.logo_path)?106:42;doc.font('Helvetica-Bold').fontSize(18).fillColor('#185c37').text(branding.name||'Green Gold ERP',bx,27,{width:275});const issuer=[branding.address,[branding.phone,branding.email].filter(Boolean).join(' | ')].filter(Boolean).join('\n');doc.font('Helvetica').fontSize(6.8).fillColor('#52665a').text(issuer,bx,58,{width:285,lineGap:2});doc.font('Helvetica-Bold').fontSize(20).fillColor('#1f2937').text(title.toUpperCase(),345,28,{width:208,align:'right'});doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#185c37').text(row.business_id,345,59,{width:208,align:'right'});doc.font('Helvetica').fontSize(7).fillColor('#64748b').text(`Generated: ${new Date().toLocaleString('en-GB')}`,345,78,{width:208,align:'right'});doc.strokeColor('#cdd8cf').moveTo(42,108).lineTo(553,108).stroke();return 128;};
    let y=newPage();const hidden=new Set(['id','company_id','password_hash','deleted_at','line_items','requested_items','generated_vouchers']);const fields=Object.entries(row).filter(([key,value])=>!hidden.has(key)&&!key.endsWith('_id')&&value!=null&&typeof value!=='object');
    const pageIfNeeded=height=>{if(y+height>650){doc.addPage();y=newPage();}};
    const section=label=>{pageIfNeeded(34);doc.roundedRect(42,y,511,25,3).fill('#185c37');doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff').text(label.toUpperCase(),52,y+9,{width:490});y+=33;};
    section('Document details');
    for(let i=0;i<fields.length;i+=2){pageIfNeeded(38);const pair=fields.slice(i,i+2);pair.forEach(([key,value],n)=>{const x=42+n*256;doc.roundedRect(x,y,247,32,3).fillAndStroke(i%4===0?'#f8faf8':'#fff','#e0e7e1');doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#64748b').text(humanize(key).toUpperCase(),x+9,y+6,{width:100});doc.font('Helvetica').fontSize(8).fillColor('#111827').text(printableValue(value),x+109,y+6,{width:128,height:22,ellipsis:true});});y+=38;}
    const collections=[['Line items',row.line_items],['Requested items',row.requested_items],['Generated vouchers',row.generated_vouchers]].filter(([,items])=>Array.isArray(items)&&items.length);
    for(const [label,items] of collections){section(label);const columns=[...new Set(items.flatMap(Object.keys))].filter(k=>!['id','purchase_order_id','requisition_id'].includes(k));const widths=columns.map(()=>511/Math.max(columns.length,1));pageIfNeeded(26);doc.rect(42,y,511,23).fill('#e8f0e9');columns.forEach((c,i)=>doc.font('Helvetica-Bold').fontSize(5.5).fillColor('#185c37').text(humanize(c).toUpperCase(),44+widths.slice(0,i).reduce((a,b)=>a+b,0),y+8,{width:widths[i]-4,align:i? 'right':'left'}));y+=25;for(const item of items){pageIfNeeded(34);doc.rect(42,y,511,30).fillAndStroke(items.indexOf(item)%2?'#fff':'#fafcf9','#e5ebe6');columns.forEach((c,i)=>doc.font('Helvetica').fontSize(6.3).fillColor('#26352b').text(printableValue(item[c]),44+widths.slice(0,i).reduce((a,b)=>a+b,0),y+7,{width:widths[i]-5,height:18,ellipsis:true,align:i?'right':'left'}));y+=30;}y+=8;}
    pageIfNeeded(155);section('Verification and authorization');const codes=await renderForEntity(entityType,row.business_id);doc.roundedRect(42,y,511,118,5).fillAndStroke('#f8faf8','#d7e2d7');doc.image(codes.qrPng,54,y+10,{width:82});doc.image(codes.barcodePng,153,y+32,{fit:[210,55]});doc.font('Helvetica-Bold').fontSize(8).fillColor('#185c37').text('DIGITALLY VERIFIABLE DOCUMENT',380,y+26,{width:155,align:'center'});doc.font('Helvetica').fontSize(6.5).fillColor('#64748b').text('Scan the QR code or barcode to verify this record and view permitted details.',380,y+49,{width:155,align:'center'});y+=130;doc.y=y;await addResponsibilityFooter(doc,req.user.company_id,entityType,row.business_id,row);
    const pages=doc.bufferedPageRange();for(let i=0;i<pages.count;i++){doc.switchToPage(i);doc.strokeColor('#e2e8e3').moveTo(42,772).lineTo(553,772).stroke();doc.font('Helvetica').fontSize(6).fillColor('#87958b').text(`${branding.name||'Green Gold ERP'} | ${title} | ${row.business_id}`,42,780,{width:390,lineBreak:false}).text(`Page ${i+1} of ${pages.count}`,480,780,{width:70,align:'right',lineBreak:false});}doc.end();
}

async function identityCardPdf(req, res) {
    const entityType = String(req.params.entityType || '').toUpperCase();
    if (!['EMPLOYEE','CUSTOMER','VENDOR','GATE_PASS'].includes(entityType)) return res.status(400).json({ error: 'Unsupported card type' });
    requireEntityAccess(req, entityType);
    const { row } = await loadEntity(entityType, req.params.businessId, req.user.company_id);
    const branding = await loadBranding(req.user.company_id);
    const requested = String(req.query.orientation || '').toLowerCase();
    const orientation = ['vertical','horizontal'].includes(requested) ? requested : (entityType === 'EMPLOYEE' || entityType === 'GATE_PASS' ? 'vertical' : 'horizontal');
    const size = orientation === 'vertical' ? [153.1, 243.8] : [243.8, 153.1];
    const name = row.full_name || row.name || row.contact_name || row.business_id;
    const subtitle = entityType === 'EMPLOYEE' ? (row.designation || 'Employee') : entityType === 'GATE_PASS' ? 'VISITOR / GATE PASS' : entityType;
    const photoFile = row.profile_photo_path || row.visitor_photo_path;
    const photoPath = photoFile ? path.join(__dirname, '..', '..', 'storage', 'profile-photos', path.basename(photoFile)) : null;
    const codes = await renderForEntity(entityType, row.business_id);
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${entityType}_${row.business_id}_${orientation}_card.pdf"`);
    const doc = new PDFDocument({ size, margin: 0, info: { Title: `${name} identity card` } });
    doc.pipe(res);
    const w=size[0], h=size[1];
    doc.rect(0,0,w,h).fill('#f7faf7');doc.rect(0,0,w,orientation==='vertical'?42:34).fill('#0c4d36');
    doc.font('Helvetica-Bold').fontSize(orientation==='vertical'?10:11).fillColor('#fff').text(branding.name||'Green Gold ERP',8,10,{width:w-16,align:'center'});
    if (orientation==='vertical') {
        if(photoPath&&fs.existsSync(photoPath)) doc.image(photoPath,49,51,{fit:[55,65],align:'center',valign:'center'}); else {doc.roundedRect(49,51,55,65,4).fill('#dce8df');doc.fontSize(20).fillColor('#5f7768').text(name.slice(0,1).toUpperCase(),49,72,{width:55,align:'center'});}
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#17241d').text(name,10,123,{width:w-20,align:'center'});
        doc.font('Helvetica').fontSize(7).fillColor('#185c37').text(subtitle,10,141,{width:w-20,align:'center'});
        doc.fontSize(6.5).fillColor('#36463d').text(row.business_id,10,155,{width:w-20,align:'center'});
        if(row.phone||row.contact_phone)doc.text(row.phone||row.contact_phone,10,168,{width:w-20,align:'center'});
        if(entityType==='GATE_PASS')doc.fontSize(5.7).text([row.affiliated_organization_name,row.visit_location&&`Visit: ${row.visit_location}`,row.host_name&&`Host: ${row.host_name}`].filter(Boolean).join('\n'),10,180,{width:88,align:'left'});
        doc.image(codes.qrPng,w-49,h-57,{width:39});
    } else {
        if(photoPath&&fs.existsSync(photoPath)) doc.image(photoPath,12,44,{fit:[60,72]}); else doc.roundedRect(12,44,60,72,4).fill('#dce8df');
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#17241d').text(name,84,48,{width:w-94});
        doc.font('Helvetica').fontSize(7).fillColor('#185c37').text(subtitle,84,68,{width:w-94});
        doc.fontSize(7).fillColor('#36463d').text(`${row.business_id}\n${row.phone||row.contact_phone||''}\n${row.email||row.affiliated_organization_name||''}`,84,82,{width:w-142,lineGap:2});
        doc.image(codes.qrPng,w-54,h-61,{width:43});
    }
    doc.rect(0,h-12,w,12).fill('#d6a62e');doc.font('Helvetica').fontSize(4.7).fillColor('#173426').text('Scan QR to verify this record. Property of the issuing organization.',5,h-8,{width:w-10,align:'center'});
    doc.end();
}

async function batchIdentifiers(req, res) {
    const items = String(req.query.items || '').split(',').filter(Boolean).slice(0, 500);
    if (!items.length) return res.status(400).json({ error: 'items query is required (TYPE:BUSINESS_ID,...)' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="green-gold-identifiers.zip"');
    const zip = new ZipArchive({ zlib: { level: 9 } });
    zip.on('error', (error) => res.destroy(error));
    zip.pipe(res);
    for (const item of items) {
        const separator = item.indexOf(':');
        const entityType = item.slice(0, separator).toUpperCase();
        const businessId = item.slice(separator + 1);
        if (!separator || !ENTITY_SOURCES[entityType]) continue;
        try { requireEntityAccess(req, entityType); } catch { continue; }
        try { await loadEntity(entityType, businessId, req.user.company_id); } catch { continue; }
        const safeName = `${entityType}_${businessId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        const codes = await renderForEntity(entityType, businessId);
        zip.append(codes.qrPng, { name: `${entityType}/${safeName}_QR.png` });
        zip.append(codes.barcodePng, { name: `${entityType}/${safeName}_BARCODE.png` });
    }
    await zip.finalize();
}

function csvEscape(value) {
    const text = printableValue(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sendCsv(res, filename, rows) {
    const keys = rows.length ? Object.keys(rows[0]) : [];
    const csv = [keys.map(csvEscape).join(','), ...rows.map((row) => keys.map((key) => csvEscape(row[key])).join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(`\uFEFF${csv}`);
}

async function balanceSheetRows(companyId, date) {
    const { rows } = await query(
        `SELECT a.business_id, a.name, a.account_type,
                COALESCE((SELECT balance_after FROM account_transactions t WHERE t.account_id = a.id AND t.created_at::date <= $2 ORDER BY t.created_at DESC, t.id DESC LIMIT 1), 0) AS balance
         FROM accounts a WHERE a.company_id = $1 AND a.deleted_at IS NULL ORDER BY a.account_type, a.name`,
        [companyId, date]
    );
    return rows;
}

async function fullBalanceSheetData(companyId,date){
    const [accounts,transactions,expenses,receivables,payables,payroll,vouchers,financial]=await Promise.all([
        balanceSheetRows(companyId,date),
        query(`SELECT at.transaction_type,at.amount,at.reference_type,at.reference_id,at.notes,at.created_at,a.business_id account_business_id,a.name account_name FROM account_transactions at JOIN accounts a ON a.id=at.account_id WHERE a.company_id=$1 AND at.created_at::date=$2 ORDER BY at.created_at`,[companyId,date]),
        query(`SELECT e.business_id,e.expense_date,e.amount,e.description,e.paid_to,e.status,ec.name category,a.name account_name FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id JOIN accounts a ON a.id=e.account_id WHERE e.company_id=$1 AND e.expense_date<=$2 ORDER BY e.expense_date DESC,e.created_at DESC`,[companyId,date]),
        query(`SELECT cr.source_type,cr.source_id,cr.description,cr.original_amount,cr.paid_amount,cr.original_amount-cr.paid_amount outstanding_amount,cr.due_date,cr.status,c.name customer_name FROM customer_receivables cr JOIN master_customers c ON c.id=cr.customer_id WHERE cr.company_id=$1 AND cr.status IN('unpaid','partial') ORDER BY cr.due_date,cr.created_at`,[companyId]),
        query(`SELECT business_id,payee,amount,category,status,bill_date,paid_at FROM bill_submissions WHERE company_id=$1 AND status IN('submitted','approved','accounts_approved','submitted_to_accounts') ORDER BY created_at DESC`,[companyId]),
        query(`SELECT pr.business_id,pr.period_month,pr.period_year,pr.status,COALESCE(sum(pi.net_pay),0) total_net_pay,COUNT(pi.id)::int employee_count FROM payroll_runs pr LEFT JOIN payroll_items pi ON pi.payroll_run_id=pr.id WHERE pr.company_id=$1 AND pr.created_at::date<=$2 GROUP BY pr.id ORDER BY pr.period_year DESC,pr.period_month DESC`,[companyId,date]),
        query(`SELECT fd.business_id,fd.document_type,fd.source_id,fd.amount,fd.description,fd.created_at,a.name account_name,c.name customer_name FROM financial_documents fd LEFT JOIN accounts a ON a.id=fd.account_id LEFT JOIN master_customers c ON c.id=fd.customer_id WHERE fd.company_id=$1 AND fd.created_at::date<=$2 AND fd.document_type IN('MONEY_RECEIPT','PAYMENT_ACCEPTANCE_VOUCHER','TRANSFER_VOUCHER') ORDER BY fd.created_at DESC`,[companyId,date]),
        query(`SELECT COALESCE((SELECT sum(amount) FROM expenses WHERE company_id=$1 AND status='approved' AND expense_date<=$2),0) expenses,COALESCE((SELECT sum(original_amount-paid_amount) FROM customer_receivables WHERE company_id=$1 AND status IN('unpaid','partial')),0) receivables,COALESCE((SELECT sum(amount) FROM bill_submissions WHERE company_id=$1 AND status IN('approved','accounts_approved','submitted_to_accounts')),0) payables,COALESCE((SELECT sum(pi.net_pay) FROM payroll_items pi JOIN payroll_runs pr ON pr.id=pi.payroll_run_id WHERE pr.company_id=$1 AND pr.status IN('processed','accounts_approved','paid') AND pr.created_at::date<=$2),0) payroll,COALESCE((SELECT sum(current_total) FROM unified_invoices WHERE company_id=$1 AND financial_impact>0 AND status<>'cancelled' AND issued_at::date<=$2),0) billed_income`,[companyId,date])
    ]);
    const incoming=transactions.rows.filter(x=>['DEPOSIT','TRANSFER_IN'].includes(x.transaction_type)).reduce((n,x)=>n+Number(x.amount),0),outgoing=transactions.rows.filter(x=>['WITHDRAWAL','TRANSFER_OUT'].includes(x.transaction_type)).reduce((n,x)=>n+Number(x.amount),0);
    const cash=accounts.filter(x=>x.account_type==='cash').reduce((n,x)=>n+Number(x.balance),0),bank=accounts.filter(x=>x.account_type==='bank').reduce((n,x)=>n+Number(x.balance),0),f=financial.rows[0];
    return {accounts,transactions:transactions.rows,expenses:expenses.rows,receivables:receivables.rows,payables:payables.rows,payroll:payroll.rows,vouchers:vouchers.rows,summary:{cash,bank,grandTotal:cash+bank,incoming,outgoing,netCashMovement:incoming-outgoing,expenses:Number(f.expenses),receivables:Number(f.receivables),payables:Number(f.payables),payroll:Number(f.payroll),billedIncome:Number(f.billed_income)}};
}

async function balanceSheetExport(req, res) {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const data = await fullBalanceSheetData(req.user.company_id,date),money=v=>`BDT ${Number(v||0).toLocaleString('en-BD',{minimumFractionDigits:2})}`;
    if (req.params.format === 'csv') {
        const rows=[
            ...Object.entries(data.summary).map(([key,value])=>({section:'SUMMARY',reference:humanize(key),amount:value})),
            ...data.accounts.map(x=>({section:'ACCOUNT BALANCE',reference:x.business_id,description:x.name,status:x.account_type,balance:x.balance})),
            ...data.transactions.map(x=>({section:'FINANCIAL ACTIVITY',type:x.transaction_type,reference:x.reference_id,date:x.created_at,description:`${x.reference_type||''} ${x.notes||''}`.trim(),status:'posted',account:x.account_name,received:['DEPOSIT','TRANSFER_IN'].includes(x.transaction_type)?x.amount:0,expense:['WITHDRAWAL','TRANSFER_OUT'].includes(x.transaction_type)?x.amount:0})),
            ...data.expenses.map(x=>({section:'FINANCIAL ACTIVITY',type:'EXPENSE / DEDUCTION',reference:x.business_id,date:x.expense_date,party:x.paid_to,description:`${x.category}: ${x.description||''}`,status:x.status,account:x.account_name,expense:x.amount})),
            ...data.receivables.map(x=>({section:'FINANCIAL ACTIVITY',type:'CUSTOMER DUE',reference:x.source_id,date:x.due_date,party:x.customer_name,description:`${x.source_type}: ${x.description||''}`,status:x.status,received:x.paid_amount,outstanding:x.outstanding_amount})),
            ...data.payables.map(x=>({section:'FINANCIAL ACTIVITY',type:['approved','accounts_approved'].includes(x.status)?'APPROVED PAYABLE':'WAITING FOR APPROVAL',reference:x.business_id,date:x.bill_date,party:x.payee,description:x.category,status:x.status,expense:x.amount,outstanding:x.amount})),
            ...data.payroll.map(x=>({section:'PAYROLL',reference:x.business_id,date:`${x.period_month}/${x.period_year}`,description:`${x.employee_count} employee(s)`,status:x.status,amount:x.total_net_pay})),
            ...data.vouchers.map(x=>({section:'FINANCIAL ACTIVITY',type:x.document_type,reference:x.business_id,date:x.created_at,party:x.customer_name,description:x.description,account:x.account_name,received:x.document_type==='MONEY_RECEIPT'?x.amount:0,expense:x.document_type==='MONEY_RECEIPT'?0:x.amount}))
        ];return sendCsv(res,`balance-sheet-${date}.csv`,rows);
    }
    const branding=await loadBranding(req.user.company_id);const doc = startPdf(res, `balance-sheet-${date}.pdf`, 'Balance Sheet', `As of ${date}`,branding);
    let y=doc.y+4;const page=()=>{doc.addPage();y=55;};const ensure=(height=20)=>{if(y+height>755)page();};const heading=(text)=>{ensure(32);doc.font('Helvetica-Bold').fillColor('#185c37').fontSize(11).text(text,48,y);y+=19;};const line=(left,right='')=>{ensure(22);doc.font('Helvetica').fillColor('#111827').fontSize(7.5).text(printableValue(left),48,y,{width:390});doc.font('Helvetica-Bold').text(printableValue(right),438,y,{width:105,align:'right'});y=Math.max(doc.y,y+16);};
    heading('Financial summary');Object.entries(data.summary).forEach(([k,v])=>line(humanize(k),money(v)));
    heading('Account balances');data.accounts.forEach(x=>line(`${x.business_id} | ${x.name} | ${x.account_type}`,money(x.balance)));
    heading('Financial transactions and pending actions');if(!data.transactions.length&&!data.expenses.length&&!data.receivables.length&&!data.payables.length&&!data.vouchers.length)line('No financial activity.');
    data.transactions.forEach(x=>line(`${new Date(x.created_at).toLocaleString('en-GB')} | ${x.transaction_type} | ${x.account_name} | ${x.reference_type||'-'} ${x.reference_id||''} | ${x.notes||''}`,`${['DEPOSIT','TRANSFER_IN'].includes(x.transaction_type)?'Received':'Expense'} ${money(x.amount)}`));
    data.vouchers.forEach(x=>line(`${new Date(x.created_at).toLocaleString('en-GB')} | ${x.document_type.replace(/_/g,' ')} | ${x.business_id} | ${x.customer_name||'-'} | ${x.account_name||'-'} | ${x.description||''}`,`${x.document_type==='MONEY_RECEIPT'?'Received':'Expense'} ${money(x.amount)}`));
    data.expenses.forEach(x=>line(`${printableValue(x.expense_date)} | EXPENSE / DEDUCTION | ${x.business_id} | ${x.paid_to||'-'} | ${x.category} | ${x.description||'-'} | ${x.account_name} | ${x.status}`,`Expense ${money(x.amount)}`));
    data.receivables.forEach(x=>line(`${printableValue(x.due_date)} | CUSTOMER DUE | ${x.source_type} ${x.source_id} | ${x.customer_name} | ${x.description||'-'} | Paid ${money(x.paid_amount)} | ${x.status}`,`Outstanding ${money(x.outstanding_amount)}`));
    data.payables.forEach(x=>line(`${printableValue(x.bill_date)} | ${['approved','accounts_approved'].includes(x.status)?'APPROVED PAYABLE':'WAITING FOR APPROVAL'} | ${x.business_id} | ${x.payee||'-'} | ${x.category||'-'} | ${x.status}`,`Payable ${money(x.amount)}`));
    heading('Payroll position');if(!data.payroll.length)line('No payroll records.');data.payroll.forEach(x=>line(`${x.business_id} | Period ${x.period_month}/${x.period_year} | ${x.employee_count} employee(s) | ${x.status}`,money(x.total_net_pay)));
    await addResponsibilityFooter(doc,req.user.company_id,'BALANCE_SHEET',date,{created_by:req.user.id});doc.end();
}

async function machineLogsExport(req, res) {
    const machineId = req.query.machineBusinessId || null;
    const { rows } = await query(
        `SELECT m.business_id AS machine_id, m.name AS machine_name, sl.shift_date, sl.shift_type,
                sl.status_at_log, sl.running_hours_this_shift, sl.handover_notes, u.username AS logged_by
         FROM machine_shift_logs sl JOIN machines m ON m.id = sl.machine_id JOIN users u ON u.id = sl.logged_by
         WHERE m.company_id = $1 AND ($2::text IS NULL OR m.business_id = $2)
         ORDER BY sl.shift_date DESC, sl.created_at DESC`, [req.user.company_id, machineId]
    );
    if (req.params.format === 'csv') return sendCsv(res, 'machine-shift-logs.csv', rows);
    const branding=await loadBranding(req.user.company_id);const doc = startPdf(res, 'machine-shift-logs.pdf', 'Machine Shift Logs', machineId || 'All machines',branding);
    let y = doc.y + 8;
    rows.forEach((row) => {
        if (y > 730) { doc.addPage(); y = 55; }
        doc.font('Helvetica-Bold').fontSize(10).text(`${row.machine_id} - ${row.machine_name}`, 48, y);
        doc.font('Helvetica').fontSize(9).text(`${printableValue(row.shift_date)} | ${row.shift_type} | ${row.status_at_log} | ${row.running_hours_this_shift} hours | ${row.logged_by}`, 48, y + 14);
        if (row.handover_notes) doc.fillColor('#4b5563').text(row.handover_notes, 48, y + 28, { width: 490 });
        y = doc.y + 14;
    });
    await addResponsibilityFooter(doc,req.user.company_id,'MACHINE_LOG_REPORT',machineId||'ALL',{created_by:req.user.id});doc.end();
}

async function accountStatementExport(req, res) {
    const { rows: accounts } = await query(`SELECT id, business_id, name FROM accounts WHERE business_id = $1 AND company_id = $2`, [req.params.businessId, req.user.company_id]);
    if (!accounts.length) return res.status(404).json({ error: 'Account not found' });
    const { rows } = await query(
        `SELECT created_at, transaction_type, reference_type, reference_id, amount, balance_after, notes
         FROM account_transactions WHERE account_id = $1 ORDER BY created_at DESC, id DESC`, [accounts[0].id]
    );
    if (req.params.format === 'csv') return sendCsv(res, `${accounts[0].business_id}-statement.csv`, rows);
    const branding=await loadBranding(req.user.company_id);const doc = startPdf(res, `${accounts[0].business_id}-statement.pdf`, 'Account Statement', `${accounts[0].business_id} - ${accounts[0].name}`,branding);
    let y = doc.y + 8;
    rows.forEach((row) => {
        if (y > 740) { doc.addPage(); y = 55; }
        doc.font('Helvetica').fontSize(8).text(new Date(row.created_at).toISOString().slice(0, 10), 48, y, { width: 65 });
        doc.text(row.transaction_type.replace(/_/g, ' '), 115, y, { width: 110 });
        doc.text(`${row.reference_type || '-'} ${row.reference_id || ''}`, 225, y, { width: 150 });
        doc.text(`BDT ${Number(row.amount).toLocaleString()}`, 375, y, { width: 80, align: 'right' });
        doc.font('Helvetica-Bold').text(`BDT ${Number(row.balance_after).toLocaleString()}`, 455, y, { width: 90, align: 'right' });
        y += 18;
    });
    await addResponsibilityFooter(doc,req.user.company_id,'ACCOUNT_STATEMENT',accounts[0].business_id,{created_by:req.user.id});doc.end();
}

async function labelSheet(req, res) {
    const kind = req.params.kind;
    const ids = String(req.query.ids || '').split(',').filter(Boolean).slice(0, 200);
    if (!ids.length || !['batches','locations'].includes(kind)) return res.status(400).json({error:'kind and ids are required'});
    const entityType = kind === 'batches' ? 'PRODUCT_BATCH' : 'STORAGE_LOCATION';
    requireEntityAccess(req, entityType);
    let rows;
    if(kind==='batches')({rows}=await query(`SELECT pbu.business_id,'PRODUCT_UNIT' AS entity_type FROM product_batch_units pbu JOIN product_batches pb ON pb.id=pbu.batch_id WHERE pb.company_id=$1 AND pb.business_id=ANY($2::text[]) ORDER BY pb.business_id,pbu.unit_number`,[req.user.company_id,ids]));
    else ({rows}=await query(`SELECT business_id,'STORAGE_LOCATION' AS entity_type FROM storage_locations WHERE company_id=$1 AND business_id=ANY($2::text[]) ORDER BY business_id`,[req.user.company_id,ids]));
    const branding=await loadBranding(req.user.company_id);const doc = startPdf(res, `${kind}-labels.pdf`, `${kind === 'batches' ? 'Product Batch' : 'Storage Location'} Labels`, `${rows.length} labels`,branding);
    const startY = doc.y + 5;
    for (let index=0; index<rows.length; index++) { const row=rows[index];
        const position=index%10; if(index>0&&position===0)doc.addPage();
        const col=position%2,rowIndex=Math.floor(position/2),x=36+col*270,y=(index<10?startY:48)+rowIndex*130;
        doc.roundedRect(x,y,258,108,4).strokeColor('#cbd5e1').stroke();
        const actualType=row.entity_type||entityType;
        doc.font('Helvetica-Bold').fillColor('#185c37').fontSize(8).text(actualType.replace(/_/g,' '),x+8,y+6,{width:242,align:'center'});
        doc.font('Helvetica-Bold').fillColor('#111827').fontSize(7).text(row.business_id,x+8,y+19,{width:242,align:'center'});
        const codes=await renderForEntity(actualType,row.business_id);
        doc.image(codes.qrPng,x+8,y+33,{width:62});
        doc.image(codes.barcodePng,x+76,y+42,{fit:[174,47]});
        doc.font('Helvetica').fillColor('#64748b').fontSize(6).text('Scan for permitted stock operations',x+75,y+94,{width:175,align:'center'});
    }
    doc.end();
}

async function stockBalanceExport(req,res){
    requireEntityAccess(req,'PRODUCT');
    const asOf=req.query.asOf||new Date().toISOString().slice(0,10);
    const {rows}=await query(`SELECT p.business_id,p.name,p.category,p.unit,w.business_id warehouse_id,w.name warehouse,
      COALESCE(sum(CASE WHEN sl.created_at::date<=$2::date AND sl.movement_type IN('IN','TRANSFER_IN') THEN sl.quantity WHEN sl.created_at::date<=$2::date AND sl.movement_type IN('OUT','TRANSFER_OUT') THEN -sl.quantity ELSE 0 END),0) quantity
      FROM products p CROSS JOIN warehouses w LEFT JOIN stock_ledger sl ON sl.product_id=p.id AND sl.warehouse_id=w.id
      WHERE p.company_id=$1 AND w.company_id=$1 AND p.deleted_at IS NULL AND w.deleted_at IS NULL
      GROUP BY p.id,w.id HAVING COALESCE(sum(CASE WHEN sl.created_at::date<=$2::date AND sl.movement_type IN('IN','TRANSFER_IN') THEN sl.quantity WHEN sl.created_at::date<=$2::date AND sl.movement_type IN('OUT','TRANSFER_OUT') THEN -sl.quantity ELSE 0 END),0)<>0 ORDER BY p.name,w.name`,[req.user.company_id,asOf]);
    const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;
    const csv=['As of,Product ID,Product,Category,Unit,Warehouse ID,Warehouse,Quantity',...rows.map(r=>[asOf,r.business_id,r.name,r.category,r.unit,r.warehouse_id,r.warehouse,r.quantity].map(esc).join(','))].join('\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="stock-balance-${asOf}.csv"`);res.send('\uFEFF'+csv);
}

async function customerMonthlyStatementExport(req,res){const month=/^\d{4}-\d{2}$/.test(req.query.month||'')?req.query.month:new Date().toISOString().slice(0,7),start=`${month}-01`,format=req.params.format;const {rows:c}=await query(`SELECT id,business_id,name FROM master_customers WHERE business_id=$1 AND company_id=$2`,[req.params.customerBusinessId,req.user.company_id]);if(!c.length)return res.status(404).json({error:'Customer not found'});const {rows:stock}=await query(`SELECT pb.business_id,p.name,p.unit,pb.received_quantity,pb.available_quantity,pb.rent_per_unit_per_cycle,pb.billing_cycle FROM product_batches pb JOIN products p ON p.id=pb.product_id WHERE pb.owner_customer_id=$1 ORDER BY p.name`,[c[0].id]);const {rows:activity}=await query(`SELECT 'RECEIVED' type,gr.business_id,pb.business_id batch_id,gr.received_quantity quantity,gr.created_at FROM goods_receipts gr JOIN product_batches pb ON pb.id=gr.batch_id WHERE gr.customer_id=$1 AND date_trunc('month',gr.created_at)=date_trunc('month',$2::date) UNION ALL SELECT 'RELEASED',sr.business_id,pb.business_id,sr.quantity,sr.created_at FROM stock_release_documents sr JOIN product_batches pb ON pb.id=sr.batch_id WHERE sr.customer_id=$1 AND date_trunc('month',sr.created_at)=date_trunc('month',$2::date) ORDER BY created_at`,[c[0].id,start]);const {rows:account}=await query(`SELECT COALESCE(sum(original_amount-paid_amount) FILTER(WHERE status IN('unpaid','partial')),0) outstanding,COALESCE(sum(original_amount) FILTER(WHERE date_trunc('month',created_at)=date_trunc('month',$2::date)),0) current_charges FROM customer_receivables WHERE customer_id=$1`,[c[0].id,start]);if(format==='csv'){const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;const csv=['Month,Customer,Batch,Product,Unit,Received total,Closing stock,Rent rate,Cycle',...stock.map(x=>[month,c[0].name,x.business_id,x.name,x.unit,x.received_quantity,x.available_quantity,x.rent_per_unit_per_cycle,x.billing_cycle].map(esc).join(',')),`"Current charges","${account[0].current_charges}"`,`"Total outstanding","${account[0].outstanding}"`].join('\n');res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="${c[0].business_id}-${month}-statement.csv"`);return res.send('\uFEFF'+csv);}const branding=await loadBranding(req.user.company_id),doc=startPdf(res,`${c[0].business_id}-${month}-statement.pdf`,'Monthly Stock and Account Statement',`${c[0].name} | ${month}`,branding);doc.font('Helvetica-Bold').fillColor('#185c37').fontSize(12).text('Account summary');doc.moveDown(.4).font('Helvetica').fillColor('#111827').fontSize(10).text(`Current month charges: BDT ${Number(account[0].current_charges).toLocaleString()}`).text(`Total outstanding: BDT ${Number(account[0].outstanding).toLocaleString()}`);doc.moveDown().font('Helvetica-Bold').fontSize(12).fillColor('#185c37').text('Closing stock');let y=doc.y+8;stock.forEach(x=>{if(y>650){doc.addPage();y=120;}doc.font('Helvetica-Bold').fillColor('#111827').fontSize(9).text(`${x.business_id} - ${x.name}`,48,y,{width:260});doc.font('Helvetica').text(`${Number(x.available_quantity).toLocaleString()} ${x.unit}`,315,y,{width:90,align:'right'}).text(`BDT ${Number(x.rent_per_unit_per_cycle).toLocaleString()} / ${x.billing_cycle}`,410,y,{width:135,align:'right'});y+=20;});doc.font('Helvetica-Bold').fillColor('#185c37').fontSize(12).text('Monthly movements',48,y+8);y+=30;activity.forEach(x=>{if(y>650){doc.addPage();y=120;}doc.font('Helvetica').fillColor('#111827').fontSize(9).text(`${new Date(x.created_at).toISOString().slice(0,10)}  ${x.type}`,48,y,{width:150}).text(`${x.batch_id}  ${Number(x.quantity).toLocaleString()}`,205,y,{width:250});y+=18;});await addResponsibilityFooter(doc,req.user.company_id,'CUSTOMER_MONTHLY_STATEMENT',`${c[0].business_id}-${month}`,{created_by:req.user.id});doc.end();}

async function dailyFinancialReportExport(req,res){
    const date=req.query.date||new Date().toISOString().slice(0,10);
    const {rows:stored}=await query(`SELECT * FROM daily_financial_reports WHERE company_id=$1 AND report_date=$2`,[req.user.company_id,date]);
    const snapshot=stored[0]?.snapshot||await buildSnapshot(req.user.company_id,date),selected=snapshot.selectedSections||['summary','accounts','transactions','expenses','bills'];
    if(req.params.format==='csv'){
        const rows=[
            ...(selected.includes('summary')?Object.entries(snapshot.summary||{}).map(([key,value])=>({section:'FINANCIAL SUMMARY',item:humanize(key),amount:value})):[]),
            ...(selected.includes('accounts')?(snapshot.accounts||[]).map(x=>({section:'ACCOUNT BALANCE',item:`${x.business_id} - ${x.name}`,opening:x.opening_balance,closing:x.closing_balance,status:x.account_type})):[]),
            ...(selected.includes('transactions')?(snapshot.transactions||[]).map(x=>({section:'DAILY RECEIVED / ACCOUNT MOVEMENT',date:x.created_at,item:`${x.account_name} - ${x.transaction_type}`,reference:`${x.reference_type||''} ${x.reference_id||''}`.trim(),description:x.notes,amount:x.amount})):[]),
            ...(selected.includes('expenses')?(snapshot.expenses||[]).map(x=>({section:'EXPENSE / DEDUCTION',item:`${x.business_id} - ${x.category}: ${x.description||''}`,party:x.paid_to,account:x.account_name,amount:x.amount,status:x.status})):[]),
            ...(selected.includes('bills')?(snapshot.bills||[]).map(x=>({section:'PAYABLE / APPROVAL QUEUE',item:`${x.business_id} - ${x.category||''}`,party:x.payee,amount:x.amount,status:x.status})):[])
        ];return sendCsv(res,`daily-financial-report-${date}.csv`,rows);
    }
    const branding=await loadBranding(req.user.company_id),doc=startPdf(res,`daily-financial-report-${date}.pdf`,'Daily Balance and Expense Report',date,branding),money=v=>`BDT ${Number(v||0).toLocaleString()}`;
    let y=doc.y;[['Opening balance',snapshot.summary.opening],['Incoming',snapshot.summary.incoming],['Outgoing',snapshot.summary.outgoing],['Closing balance',snapshot.summary.closing],['Difference',snapshot.summary.reconciliationDifference]].forEach(([label,value],i)=>{const x=48+i*100;doc.font('Helvetica-Bold').fillColor('#185c37').fontSize(7).text(label,x,y,{width:94,align:'center'});doc.font('Helvetica').fillColor('#111827').fontSize(8).text(money(value),x,y+15,{width:94,align:'center'});});
    y+=50;doc.font('Helvetica-Bold').fillColor('#185c37').fontSize(11).text('Account closing balances',48,y);y+=20;
    for(const row of snapshot.accounts){if(y>630){doc.addPage();y=120;}doc.font('Helvetica').fillColor('#111827').fontSize(8).text(`${row.business_id} · ${row.name}`,48,y,{width:350}).font('Helvetica-Bold').text(money(row.closing_balance),410,y,{width:130,align:'right'});y+=16;}
    y+=8;doc.font('Helvetica-Bold').fillColor('#185c37').fontSize(11).text('Daily expenses',48,y);y+=20;
    if(!snapshot.expenses.length){doc.font('Helvetica').fillColor('#64748b').fontSize(8).text('No expenses recorded for this date.',48,y);y+=18;}
    for(const row of snapshot.expenses){if(y>630){doc.addPage();y=120;}doc.font('Helvetica').fillColor('#111827').fontSize(8).text(`${row.business_id} · ${row.category} · ${row.description||row.paid_to||''}`,48,y,{width:390}).font('Helvetica-Bold').text(money(row.amount),445,y,{width:95,align:'right'});y+=18;}
    const signRow=stored[0]||{created_by:req.user.id};await addResponsibilityFooter(doc,req.user.company_id,'DAILY_FINANCIAL_REPORT',signRow.business_id||date,signRow);doc.end();
}

async function dailyFinancialReportExportV2(req,res){
    const date=req.query.date||new Date().toISOString().slice(0,10),{rows:stored}=await query(`SELECT * FROM daily_financial_reports WHERE company_id=$1 AND report_date=$2`,[req.user.company_id,date]);
    const snapshot=stored[0]?.snapshot||await buildSnapshot(req.user.company_id,date),selected=snapshot.selectedSections||['summary','accounts','transactions','expenses','bills'];
    if(req.params.format==='csv'){
        const rows=[
            ...(selected.includes('summary')?Object.entries(snapshot.summary||{}).map(([key,value])=>({section:'FINANCIAL SUMMARY',item:humanize(key),amount:value})):[]),
            ...(selected.includes('accounts')?((snapshot.accounts||[]).length?(snapshot.accounts||[]).map(x=>({section:'ACCOUNT BALANCES',reference:x.business_id,type:x.account_type,item:x.name,opening:x.opening_balance,closing:x.closing_balance})):[{section:'ACCOUNT BALANCES',item:'No records for selected date'}]):[]),
            ...(selected.includes('transactions')?((snapshot.transactions||[]).length?(snapshot.transactions||[]).map(x=>({section:'DAILY RECEIVED / ACCOUNT MOVEMENT',date:x.created_at,type:x.transaction_type,reference:`${x.reference_type||''} ${x.reference_id||''}`.trim(),item:x.account_name,description:x.notes,amount:x.amount})):[{section:'DAILY RECEIVED / ACCOUNT MOVEMENT',item:'No records for selected date'}]):[]),
            ...(selected.includes('expenses')?((snapshot.expenses||[]).length?(snapshot.expenses||[]).map(x=>({section:'EXPENSES / DEDUCTIONS',reference:x.business_id,type:x.category,party:x.paid_to,item:x.description,status:x.status,account:x.account_name,amount:x.amount})):[{section:'EXPENSES / DEDUCTIONS',item:'No records for selected date'}]):[]),
            ...(selected.includes('bills')?((snapshot.bills||[]).length?(snapshot.bills||[]).map(x=>({section:'PAYABLES / APPROVAL QUEUE',reference:x.business_id,type:x.category,party:x.payee,status:x.status,amount:x.amount})):[{section:'PAYABLES / APPROVAL QUEUE',item:'No records for selected date'}]):[]),
            ...selected.filter(key=>!['summary','accounts','transactions','expenses','bills'].includes(key)).flatMap(key=>(snapshot[key]||[]).length?(snapshot[key]||[]).map(row=>({section:humanize(key).toUpperCase(),...row})):[{section:humanize(key).toUpperCase(),item:'No records for selected date'}])
        ];return sendCsv(res,`daily-financial-report-${date}.csv`,rows);
    }
    const branding=await loadBranding(req.user.company_id),doc=startPdf(res,`daily-financial-report-${date}.pdf`,'Submitted Financial Report',`${date} | Selected: ${selected.map(humanize).join(', ')}`,branding),money=v=>`BDT ${Number(v||0).toLocaleString()}`;
    let y=doc.y+4;const ensure=(height=22)=>{if(y+height>650){doc.addPage();y=75;}};const heading=text=>{ensure(34);doc.font('Helvetica-Bold').fillColor('#185c37').fontSize(11).text(text,48,y);y+=20;};const line=(left,right='')=>{ensure();doc.font('Helvetica').fillColor('#111827').fontSize(7.5).text(left,48,y,{width:390});doc.font('Helvetica-Bold').text(right,440,y,{width:102,align:'right'});y=Math.max(y+17,doc.y);};
    if(selected.includes('summary')){heading('Financial summary');Object.entries(snapshot.summary||{}).forEach(([key,value])=>line(humanize(key),money(value)));}
    if(selected.includes('accounts')){heading('Account balances');if(!(snapshot.accounts||[]).length)line('No account records.');for(const row of snapshot.accounts||[])line(`${row.business_id} | ${row.name} | ${row.account_type} | Opening ${money(row.opening_balance)}`,`Closing ${money(row.closing_balance)}`);}
    if(selected.includes('transactions')){heading('Daily received and account movements');if(!(snapshot.transactions||[]).length)line('No account movements for this date.');for(const row of snapshot.transactions||[])line(`${new Date(row.created_at).toLocaleString('en-GB')} | ${row.account_name} | ${row.transaction_type} | ${row.reference_type||'-'} ${row.reference_id||''} | ${row.notes||''}`,money(row.amount));}
    if(selected.includes('expenses')){heading('Expenses and deductions');if(!(snapshot.expenses||[]).length)line('No expenses recorded for this date.');for(const row of snapshot.expenses||[])line(`${row.business_id} | ${row.category} | ${row.description||'-'} | ${row.paid_to||'-'} | ${row.account_name} | ${row.status}`,money(row.amount));}
    if(selected.includes('bills')){heading('Payables and bills waiting for approval');if(!(snapshot.bills||[]).length)line('No bills or payables for this date.');for(const row of snapshot.bills||[])line(`${row.business_id} | ${row.payee||'-'} | ${row.category||'-'} | ${row.status}`,money(row.amount));}
    for(const key of selected.filter(x=>!['summary','accounts','transactions','expenses','bills'].includes(x))){heading(humanize(key));const rows=snapshot[key]||[];if(!rows.length)line('No records for this date.');for(const row of rows){const values=Object.entries(row).filter(([,v])=>v!==null&&v!==undefined&&v!=='').slice(0,9).map(([k,v])=>`${humanize(k)}: ${v instanceof Date?v.toISOString():v}`);line(values.join(' | '));}}
    const signRow=stored[0]||{created_by:req.user.id};await addResponsibilityFooter(doc,req.user.company_id,'DAILY_FINANCIAL_REPORT',signRow.business_id||date,signRow);doc.end();
}

module.exports = { entityPdf, identityCardPdf, batchIdentifiers, balanceSheetExport, machineLogsExport, accountStatementExport, labelSheet, stockBalanceExport, customerMonthlyStatementExport, dailyFinancialReportExport:dailyFinancialReportExportV2, ENTITY_SOURCES, financialInvoiceLines, financialInvoicePdfV2 };
