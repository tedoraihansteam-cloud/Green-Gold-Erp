import SimpleResourcePage from '../../components/SimpleResourcePage';
import Pill from '../../components/Pill';
import BusinessIdentifier from '../../components/BusinessIdentifier';
import {Link} from 'react-router-dom';

export default function CustomersPage() {
    return (
        <SimpleResourcePage
            title="Customers"
            entityType="CUSTOMER"
            subtitle="Permanent customer master records"
            listPath="/customers"
            listKey="customers"
            createPath="/customers"
            createPermission="SALES_CREATE"
            emptyMessage="No customers yet. Add the first one to get started."
            columns={[
                { key: 'business_id', label: 'ID', render: (r) => <BusinessIdentifier entityType="CUSTOMER" businessId={r.business_id} /> },
                { key: 'name', label: 'Name', render:r=><Link to={`/customers/${r.business_id}`}>{r.name}</Link> },
                { key: 'phone', label: 'Phone' },
                { key: 'customer_type', label: 'Type' },
                { key: 'status', label: 'Status', render: (r) => <Pill status={r.status} /> }
            ]}
            formFields={[
                { name: 'name', label: 'Name', required: true, fullWidth: true },
                { name: 'phone', label: 'Phone' },
                { name: 'email', label: 'Email', type: 'email' },
                { name: 'customerType', label: 'Type', type: 'select', options: [
                    { value: 'retail', label: 'Retail' }, { value: 'wholesale', label: 'Wholesale' }, { value: 'cold_storage_client', label: 'Cold storage client' }
                ]},
                {name:'entityKind',label:'Customer identity',type:'select',default:'individual',options:[{value:'individual',label:'Individual'},{value:'organization',label:'Organization'}]},
                { name: 'creditPeriodDays', label: 'Credit period (days)', type: 'number', step: '1', default: '0', hint: 'Used to calculate invoice due dates automatically' },
                {name:'defaultRentPerUnit',label:'Default rent per unit (৳)',type:'number',step:'0.01'},
                {name:'penaltyPercent',label:'Overdue penalty (%)',type:'number',step:'0.01'},
                {name:'penaltyGraceDays',label:'Penalty grace period (days)',type:'number',step:'1'},
                { name: 'address', label: 'Address', type: 'textarea', fullWidth: true }
            ]}
        />
    );
}
