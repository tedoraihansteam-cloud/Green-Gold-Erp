# Green Gold ERP

Green Gold ERP is an integrated business, finance, inventory, cold-storage, manufacturing, procurement, HR, security, logistics, reporting, and workflow platform for Green Gold Agro Products Ltd.

This repository contains the complete application source: Express/PostgreSQL backend, React/Vite web interface, database migrations, document and QR/barcode services, Docker setup, and Electron desktop launcher.

> Production databases, uploaded documents, generated codes, passwords, tokens, and `.env` files are intentionally excluded from Git.

## Functional coverage

### Organization, access, and workspace

- Company, branch, office, factory, store, department, and operational-location configuration
- Staff, customer, vendor, and administrator accounts
- Role and per-user permissions for viewing, creating, editing, reviewing, approving, authorizing, and financial actions
- Configurable workflow assignments and individual duties
- Personal theme, language, date/time, print-size, sidebar, and operational-scope settings
- Append-only auditing and controlled data-correction workflows

### Universal navigation and data entry

- Search across customers, employees, vendors, invoices, products, gate passes, requests, and business IDs
- Permission-aware global Create menu
- Excel/data upload with detection, mapping, validation, review, and automated import
- Minimal source-file retention after successful processing
- Entity-specific QR/barcode scan results without exposing unrelated records

### Inventory, receiving, and storage

- Products, units, warehouses, hierarchical locations, batches, stock balances, and stock ledger
- GRN/goods receiving with location-first or batch-first QR/barcode flows and manual fallback
- Batch and product traceability from receipt through storage and delivery
- Delivery-linked stock deduction

### Procurement and requisitions

- Staff requisitions through My Letters & Requests
- Department review, approval, purchasing, receiving, and closure
- Purchase orders for raw materials, machinery, electrical equipment, office supplies, consumables, and services
- New or existing vendors and catalogue/non-catalogue line items
- Receiving at cold stores, head office, factories, departments, branches, and teams
- Partial/full vendor payment with accounts integration

### Customers, rentals, and invoices

- Central invoices for sales, rent collection, goods receiving, delivery, and rental contracts
- Customer history, previous due, payment, balance, stock, delivery, labor, service, and rental details
- Product units, quantities, rates, QR codes, and barcodes on documents
- Automatic rental billing, monthly cycles, and configurable operational-year policies
- Rent collection with previous/current rent, labor, service/other charges, tax, discount, partial payment, and commitments
- Money receipts and due receipts connected to accounts, receivables, invoices, and vouchers
- Invoice detail, review, approval, printing, and downloads

### Delivery, gate passes, and security

- Delivery invoices linked to source documents, customers, stock, and gate passes
- Mandatory gate pass before physical delivery
- QR/barcode verification, authorized exit remarks, confirmation, and exit notes
- Gate-pass and delivery requests routed to My Letters & Requests

### Accounts and financial control

- Cash/bank accounts, statements, deposits, withdrawals, transfers, remarks, and overdraft controls
- Automatic expenses for confirmed external payments; internal transfers remain non-expense movements
- Configurable approval limits through workflow settings
- Vendor bills, employee/external claims, allowance, travel, food, and supporting documents
- Bill lifecycle: draft, submit, review, approve, pay, acceptance, and signed vouchers
- Payroll and procurement posting to accounts and financial reports
- Customer receipt allocation against receivables
- General ledger, journal entries, accounting periods, reconciliation, and financial closing
- Daily transactions, balances, expenses, payables, receivables, pending approvals, PDF, CSV, and print reports

### HR and manufacturing

- Employees, salary templates/history, payroll runs, attendance, clock-in/out location, tasks, and task reports
- Department and management reporting controlled by permission
- Machines/equipment, configurable shifts, shift run times, status, remarks, incidents, maintenance, and handover
- Authorized machine scan/click history for at least two years of operational records

### Logistics, reports, and integrations

- Vehicles, dispatch, delivery completion/failure, and availability
- Permission-based financial, inventory, vehicle, receiving, manufacturing, attendance, task, security, and management reports
- Selectable report content with prepare, review, approve, authorize, print, PDF, and CSV workflow
- Notices, alerts, password-recovery requests, API integrations, fingerprint/NFC attendance, scanners, CCTV events, and temperature-device configuration

## Architecture

```text
green-gold-erp/
├── src/
│   ├── controllers/       Business workflows
│   ├── routes/            REST API routes
│   ├── services/          Ledger, rental, document, QR and audit services
│   ├── middleware/        Authentication, RBAC and error handling
│   └── db/migrations/     Ordered PostgreSQL upgrades
├── frontend/              React 18 + Vite application
├── electron/              Desktop launcher
├── storage/               Runtime files; contents excluded from Git
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

Stack: Node.js, Express, PostgreSQL, React, Vite, Electron, PDFKit, ExcelJS, QRCode, BWIP-JS, JWT, Docker.

## Requirements

- Node.js 20+
- npm
- PostgreSQL 16 or a compatible supported release
- Docker Desktop is optional

## Local installation

```bash
git clone https://github.com/tedoraihansteam-cloud/Green-Gold-Erp.git
cd Green-Gold-Erp
npm install
npm --prefix frontend install
```

Create a local environment file:

```powershell
Copy-Item .env.example .env
```

Linux/macOS: `cp .env.example .env`. Replace every placeholder with secure values, create the configured PostgreSQL database, then run:

```bash
npm run migrate
npm run bootstrap
npm --prefix frontend run build
npm start
```

Open `http://localhost:4000`. On Windows, the supplied desktop launcher can open the installed application without manually entering npm commands after initial setup.

## Docker

```bash
cp .env.example .env
# Configure secure values in .env
docker compose up --build
```

The entrypoint waits for PostgreSQL, runs migrations/bootstrap, and starts the ERP on port 4000.

## Important environment variables

| Variable | Purpose |
|---|---|
| `PORT`, `NODE_ENV` | Application runtime |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` | PostgreSQL connection |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Authentication signing and expiry |
| `QR_SIGNING_SECRET` | QR authenticity |
| `APP_BASE_URL` | Address used by QR links |
| `EXPENSE_AUTO_APPROVE_THRESHOLD` | Initial fallback approval threshold |
| `BOOTSTRAP_*` | Initial company/admin setup |

Never commit `.env`. Rotate any credential that has been shared or exposed.

## Upgrades and data preservation

Migrations under `src/db/migrations` are ordered and additive. For an existing installation:

1. Back up PostgreSQL and `storage/`.
2. Pull the updated source and install dependencies.
3. Run `npm run migrate`.
4. Rebuild the frontend and restart.
5. Verify login, accounts, invoices, stock, and reports.

Do not replace production `.env`, delete the database, or edit posted financial/stock records directly. Use correction, reversal, and approval workflows.

Backup example:

```bash
pg_dump -Fc -d green_gold_erp -f green_gold_erp.backup
```

## Financial integrity rules

- Confirmed external payments create withdrawals and ledger/expense records.
- Internal transfers do not create business expenses.
- Commitments do not alter balances until payment is confirmed.
- Posted transactions should be reversed, not silently changed or deleted.
- Delivery requires stock and gate-pass workflows.
- Permissions control financial, operational, HR, and management visibility.

## Documents and runtime storage

Invoices, vouchers, slips, purchase orders, gate passes, receipts, and reports share document services for consistent identity, issuing location, signatures, QR/barcodes, printing, and PDF output.

Uploads and generated files live under `storage/` and are excluded from Git. Back them up separately. Universal-import source files may be deleted after processing while normalized records and audit metadata remain.

## Security and deployment checklist

- Use HTTPS and restrict database network access.
- Use strong JWT/QR secrets and individual accounts.
- Apply least-privilege roles and review approval/correction permissions.
- Back up database and storage; test restoration.
- Review audit logs and failed authentication/device activity.
- Reconcile and close accounting periods.

## Validation

```powershell
Get-ChildItem src -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
npm --prefix frontend run build
```

Before production, test authentication, permissions, customer/rent receipt, bill/payroll/procurement payment, GRN, delivery stock deduction, gate-pass exit, attendance, report approvals, PDF downloads, and backup restoration against staging data.

## Development rules

- Business IDs are permanent and never reused.
- Stock and financial history use ledger/reversal concepts wherever possible.
- New modules should include permissions, numbering, audit events, documents, search mapping, workflow routing, and reports.
- Device integrations belong in Integration & Device Hub with authenticated, validated events.

## Ownership

Maintained for Green Gold Agro Products Ltd. No open-source license is granted unless the repository owner adds one explicitly.
