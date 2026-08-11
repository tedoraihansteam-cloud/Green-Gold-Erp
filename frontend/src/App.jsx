import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import NonCustomerRoute from './components/NonCustomerRoute';
import StaffRoute from './components/StaffRoute';
import Layout from './components/Layout';

import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import CustomersPage from './pages/customers/CustomersPage';
import VendorsPage from './pages/vendors/VendorsPage';
import EmployeesPage from './pages/employees/EmployeesPage';
import EmployeeDetailPage from './pages/employees/EmployeeDetailPage';
import ProductsPage from './pages/inventory/ProductsPage';
import WarehousesPage from './pages/inventory/WarehousesPage';
import StockPage from './pages/inventory/StockPage';
import InvoicesPage from './pages/sales/InvoicesPage';
import InvoiceDetailPage from './pages/sales/InvoiceDetailPage';
import AccountsPage from './pages/accounts/AccountsPage';
import AccountStatementPage from './pages/accounts/AccountStatementPage';
import BalanceSheetPage from './pages/accounts/BalanceSheetPage';
import ExpensesPage from './pages/expenses/ExpensesPage';
import PayrollRunsPage from './pages/hr/PayrollRunsPage';
import SalaryTemplatesPage from './pages/hr/SalaryTemplatesPage';
import BudgetsPage from './pages/budget/BudgetsPage';
import GatePassesPage from './pages/security/GatePassesPage';
import StorageLocationsPage from './pages/coldstorage/StorageLocationsPage';
import RentalPoliciesPage from './pages/coldstorage/RentalPoliciesPage';
import ContractsPage from './pages/coldstorage/ContractsPage';
import MachinesPage from './pages/manufacturing/MachinesPage';
import MachineShiftReportsPage from './pages/manufacturing/MachineShiftReportsPage';
import MachineHistoryPage from './pages/manufacturing/MachineHistoryPage';
import IncidentsPage from './pages/manufacturing/IncidentsPage';
import VehiclesPage from './pages/logistics/VehiclesPage';
import DeliveriesPage from './pages/logistics/DeliveriesPage';
import ReportsPage from './pages/reports/ReportsPage';
import ApprovalsPage from './pages/admin/ApprovalsPage';
import RolesPage from './pages/admin/RolesPage';
import UsersPage from './pages/admin/UsersPage';
import NoticesPage from './pages/notices/NoticesPage';
import ScannerPage from './pages/ScannerPage';
import ProfilePage from './pages/ProfilePage';
import ReceivablesPage from './pages/accounts/ReceivablesPage';
import BatchesPage from './pages/inventory/BatchesPage';
import LaborChargesPage from './pages/coldstorage/LaborChargesPage';
import CustomerPortalPage from './pages/CustomerPortalPage';
import CustomerDetailPage from './pages/customers/CustomerDetailPage';
import RequestsPage from './pages/RequestsPage';
import AppSettingsPage from './pages/admin/AppSettingsPage';
import BillSubmissionsPage from './pages/BillSubmissionsPage';
import BillDetailPage from './pages/BillDetailPage';
import WorkforcePage from './pages/hr/WorkforcePage';
import PurchaseOrdersPage from './pages/procurement/PurchaseOrdersPage';
import PurchaseOrderDetailPage from './pages/procurement/PurchaseOrderDetailPage';
import GeneralLedgerPage from './pages/accounts/GeneralLedgerPage';
import FinancialClosingPage from './pages/accounts/FinancialClosingPage';
import RequisitionsPage from './pages/procurement/RequisitionsPage';
import DepartmentsPage from './pages/admin/DepartmentsPage';
import RequisitionDetailPage from './pages/procurement/RequisitionDetailPage';
import VendorDetailPage from './pages/vendors/VendorDetailPage';
import DataCorrectionsPage from './pages/admin/DataCorrectionsPage';
import IntegrationHubPage from './pages/admin/IntegrationHubPage';

export default function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />

                    <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                        <Route index element={<DashboardPage />} />
                        <Route path="reports" element={<ReportsPage />} />
                        <Route path="notices" element={<NoticesPage />} />
                        <Route path="scan" element={<NonCustomerRoute><ScannerPage /></NonCustomerRoute>} />
                        <Route path="profile" element={<ProfilePage />} />
                        <Route path="staff-workspace" element={<StaffRoute><WorkforcePage /></StaffRoute>} />
                        <Route path="requests" element={<RequestsPage />} />
                        <Route path="bills" element={<NonCustomerRoute><BillSubmissionsPage /></NonCustomerRoute>} />
                        <Route path="bills/:businessId" element={<NonCustomerRoute><BillDetailPage /></NonCustomerRoute>} />
                        <Route path="admin/settings" element={<AppSettingsPage />} />
                        <Route path="admin/settings/:section" element={<AppSettingsPage />} />
                        <Route path="accounts/receivables" element={<ReceivablesPage />} />
                        <Route path="inventory/batches" element={<BatchesPage />} />
                        <Route path="cold-storage/charges" element={<LaborChargesPage />} />
                        <Route path="customer-portal" element={<CustomerPortalPage />} />

                        <Route path="customers" element={<CustomersPage />} />
                        <Route path="customers/:businessId" element={<CustomerDetailPage />} />
                        <Route path="invoices" element={<InvoicesPage />} />
                        <Route path="invoices/:businessId" element={<InvoiceDetailPage />} />

                        <Route path="vendors" element={<VendorsPage />} />
                        <Route path="vendors/:businessId" element={<VendorDetailPage />} />
                        <Route path="inventory/products" element={<ProductsPage />} />
                        <Route path="inventory/warehouses" element={<WarehousesPage />} />
                        <Route path="inventory/stock" element={<StockPage />} />
                        <Route path="procurement/purchase-orders" element={<PurchaseOrdersPage />} />
                        <Route path="procurement/requisitions" element={<NonCustomerRoute><RequisitionsPage /></NonCustomerRoute>} />
                        <Route path="procurement/requisitions/:businessId" element={<NonCustomerRoute><RequisitionDetailPage /></NonCustomerRoute>} />
                        <Route path="procurement/purchase-orders/:businessId" element={<PurchaseOrderDetailPage />} />

                        <Route path="employees" element={<EmployeesPage />} />
                        <Route path="employees/:businessId" element={<EmployeeDetailPage />} />
                        <Route path="hr/payroll" element={<PayrollRunsPage />} />
                        <Route path="hr/salary-templates" element={<SalaryTemplatesPage />} />
                        <Route path="budgets" element={<BudgetsPage />} />

                        <Route path="accounts" element={<AccountsPage />} />
                        <Route path="accounts/balance-sheet" element={<BalanceSheetPage />} />
                        <Route path="accounts/general-ledger" element={<GeneralLedgerPage />} />
                        <Route path="accounts/financial-closing" element={<FinancialClosingPage />} />
                        <Route path="accounts/:businessId" element={<AccountStatementPage />} />
                        <Route path="expenses" element={<ExpensesPage />} />

                        <Route path="gate-passes" element={<GatePassesPage />} />

                        <Route path="cold-storage/locations" element={<StorageLocationsPage />} />
                        <Route path="cold-storage/policies" element={<RentalPoliciesPage />} />
                        <Route path="cold-storage/contracts" element={<ContractsPage />} />

                        <Route path="manufacturing/machines" element={<MachinesPage />} />
                        <Route path="manufacturing/shift-reports" element={<MachineShiftReportsPage />} />
                        <Route path="manufacturing/machines/:businessId/history" element={<MachineHistoryPage />} />
                        <Route path="manufacturing/incidents" element={<IncidentsPage />} />

                        <Route path="logistics/vehicles" element={<VehiclesPage />} />
                        <Route path="logistics/deliveries" element={<DeliveriesPage />} />

                        <Route path="admin/approvals" element={<ApprovalsPage />} />
                        <Route path="admin/roles" element={<RolesPage />} />
                        <Route path="admin/users" element={<UsersPage />} />
                        <Route path="admin/data-corrections" element={<DataCorrectionsPage />} />
                        <Route path="admin/integration-hub" element={<IntegrationHubPage />} />
                        <Route path="admin/departments" element={<DepartmentsPage />} />
                    </Route>
                </Routes>
            </AuthProvider>
        </BrowserRouter>
    );
}
