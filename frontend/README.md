# Green Gold ERP — Frontend

React + Vite single-page app. Covers essentially the entire backend surface
built so far: auth/registration, dashboard, customers, vendors, employees
(with permanent salary history), inventory (products/warehouses/stock),
sales invoicing, accounts/finance (cash & bank, transfers, expenses,
balance sheet), payroll (draft/adjust/process), budgets (live variance),
gate passes, cold storage (locations, rental policies, contracts,
billing), manufacturing/machine room (machines, shift logs, incidents),
logistics (vehicles, deliveries), reports (sales, inventory, financial,
cold storage occupancy), and admin (roles with a permission matrix
editor, users, access approvals).

**A note on scope:** this was built and verified without a live browser
available in the build environment - the production build was tested,
every single API path/method/permission-code/response-shape the frontend
uses was cross-checked line-by-line against the actual backend routes
(not just assumed), and the combined server was tested serving real
requests end to end. It has not been clicked through by a human yet. Test
it after downloading and let me know if anything doesn't look right -
that's the one class of bug this process can't fully catch. It did
already catch one real bug this way: a payroll form left blank sends `''`
for optional fields, which crashed the backend (`??` treats `''` as a
real value, not "unset") - found by testing the exact request shape a
browser form produces, not just the happy path, and fixed.

## Design

Not a generic dashboard template - grounded in the actual company name
and business:
- **Colors**: deep "paddy" green (rice-field green, matches "Green") +
  "husk" gold (matches "Gold") as the primary accent, warm paper
  background instead of stark white or dark mode
- **Type**: Fraunces (serif, italic) for the wordmark and page titles,
  IBM Plex Sans for UI text, IBM Plex Mono for business IDs and money
  (tabular figures so columns of numbers actually align)
- **Signature element**: the "Green Gold" wordmark treatment with a small
  grain-sheaf mark, kept to the sidebar/login screen only - everything
  else stays deliberately quiet since this is a tool people use all day,
  not a marketing page

## Setup

```bash
cd frontend
npm install
npm run dev        # starts on http://localhost:5173, proxies /api to the backend on :4000
```

Run the backend (`npm start` in the project root) at the same time -
the Vite dev server proxies API calls to it.

## Production build

```bash
npm run build       # outputs to frontend/dist
```

If `frontend/dist` exists, the backend automatically serves it (see
`src/app.js`) - so in production you only need to run the Node server;
it serves both the API and the UI on the same port. Client-side routes
(like `/invoices/INV-...`) correctly fall back to the app shell instead
of 404ing - verified with curl against the built output.

## Structure

```
src/
  lib/apiClient.js       fetch wrapper - attaches JWT, normalizes errors
  lib/useApi.js           small hook: fetch on mount + reload()
  context/AuthContext.jsx login/logout state, permission-check helper (can())
  components/
    Layout.jsx            sidebar (permission-gated nav) + topbar
    SimpleResourcePage.jsx generic list+create pattern, used by most master-data pages
    DataTable.jsx, Modal.jsx, Pill.jsx, Icons.jsx
  pages/                  one folder per module; pages with multi-step or
                          special workflows (invoices, cold storage billing,
                          gate pass scanning, role permission matrix) have
                          bespoke components instead of the generic pattern
```

## Known gaps

- A couple of admin actions (creating a role, editing its permissions,
  assigning/removing user roles) aren't individually permission-gated in
  the UI the way most buttons are - they're behind the page-level
  `USER_MANAGEMENT_VIEW` gate, and the backend still enforces the finer
  permissions correctly, so the worst case is a user sees a button that
  then shows a clean error message rather than silently failing.
- No offline support, no real-time updates (data refreshes on action, not
  via websockets) - matches the backend's current scope.
- Employee creation doesn't expose branch/department selection yet since
  that part of the org-structure UI wasn't built out.
