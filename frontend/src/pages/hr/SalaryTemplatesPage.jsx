import SimpleResourcePage from '../../components/SimpleResourcePage';
import BusinessIdentifier from '../../components/BusinessIdentifier';

export default function SalaryTemplatesPage() {
    return (
        <SimpleResourcePage
            title="Salary templates"
            entityType="SALARY_TEMPLATE"
            subtitle="Position-based salary structures — apply one when setting an employee's salary"
            listPath="/hr/salary-templates"
            listKey="templates"
            createPath="/hr/salary-templates"
            createPermission="HR_CREATE"
            emptyMessage="No salary templates yet."
            columns={[
                { key: 'business_id', label: 'ID', render: (r) => <BusinessIdentifier entityType="SALARY_TEMPLATE" businessId={r.business_id} /> },
                { key: 'name', label: 'Name' },
                { key: 'basic', label: 'Basic', align: 'right', render: (r) => <span className="num">৳{Number(r.basic).toLocaleString()}</span> },
                { key: 'house_rent', label: 'House rent', align: 'right', render: (r) => <span className="num">৳{Number(r.house_rent).toLocaleString()}</span> },
                { key: 'provident_fund_percent', label: 'PF %', align: 'right', render: (r) => <span className="num">{r.provident_fund_percent}%</span> }
            ]}
            formFields={[
                { name: 'name', label: 'Name', required: true, fullWidth: true, placeholder: 'e.g. Sales Officer - Grade 1' },
                { name: 'basic', label: 'Basic (৳)', type: 'number', step: '0.01', required: true },
                { name: 'houseRent', label: 'House rent (৳)', type: 'number', step: '0.01' },
                { name: 'medical', label: 'Medical (৳)', type: 'number', step: '0.01' },
                { name: 'transport', label: 'Transport (৳)', type: 'number', step: '0.01' },
                { name: 'food', label: 'Food (৳)', type: 'number', step: '0.01' },
                { name: 'specialAllowance', label: 'Special allowance (৳)', type: 'number', step: '0.01' },
                { name: 'providentFundPercent', label: 'Provident fund %', type: 'number', step: '0.01' }
            ]}
        />
    );
}
