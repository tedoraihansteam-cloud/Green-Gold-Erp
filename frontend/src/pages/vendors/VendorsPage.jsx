import SimpleResourcePage from '../../components/SimpleResourcePage';
import BusinessIdentifier from '../../components/BusinessIdentifier';
import Pill from '../../components/Pill';
import { Link } from 'react-router-dom';

export default function VendorsPage() {
    return (
        <SimpleResourcePage
            title="Vendors"
            entityType="VENDOR"
            subtitle="Permanent vendor / supplier master records"
            listPath="/vendors"
            listKey="vendors"
            createPath="/vendors"
            createPermission="INVENTORY_CREATE"
            emptyMessage="No vendors yet."
            columns={[
                { key: 'business_id', label: 'ID', render: (r) => <Link to={`/vendors/${r.business_id}`}><BusinessIdentifier entityType="VENDOR" businessId={r.business_id} /></Link> },
                { key: 'name', label: 'Name' },
                { key: 'phone', label: 'Phone' },
                { key: 'vendor_type', label: 'Type' },
                { key: 'status', label: 'Status', render: (r) => <Pill status={r.status} /> }
            ]}
            formFields={[
                { name: 'name', label: 'Name', required: true, fullWidth: true },
                { name: 'phone', label: 'Phone' },
                { name: 'email', label: 'Email', type: 'email' },
                { name: 'vendorType', label: 'Type', placeholder: 'e.g. raw_material' },
                { name: 'address', label: 'Address', type: 'textarea', fullWidth: true }
            ]}
        />
    );
}
