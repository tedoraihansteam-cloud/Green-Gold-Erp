import SimpleResourcePage from '../../components/SimpleResourcePage';
import BusinessIdentifier from '../../components/BusinessIdentifier';

export default function WarehousesPage() {
    return (
        <SimpleResourcePage
            title="Warehouses"
            entityType="WAREHOUSE"
            subtitle="Physical storage sites — the 'building' level for cold storage locations too"
            listPath="/inventory/warehouses"
            listKey="warehouses"
            createPath="/inventory/warehouses"
            createPermission="INVENTORY_CREATE"
            emptyMessage="No warehouses yet."
            columns={[
                { key: 'business_id', label: 'ID', render: (r) => <BusinessIdentifier entityType="WAREHOUSE" businessId={r.business_id} /> },
                { key: 'name', label: 'Name' },
                { key: 'location_notes', label: 'Notes' }
            ]}
            formFields={[
                { name: 'name', label: 'Name', required: true, fullWidth: true },
                { name: 'locationNotes', label: 'Notes', type: 'textarea', fullWidth: true }
            ]}
        />
    );
}
