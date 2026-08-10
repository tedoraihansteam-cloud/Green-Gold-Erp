import SimpleResourcePage from '../../components/SimpleResourcePage';
import BusinessIdentifier from '../../components/BusinessIdentifier';
import Pill from '../../components/Pill';

export default function VehiclesPage() {
    return (
        <SimpleResourcePage
            title="Vehicles"
            entityType="VEHICLE"
            subtitle="Delivery fleet — status tracks automatically as deliveries are dispatched and completed"
            listPath="/logistics/vehicles"
            listKey="vehicles"
            createPath="/logistics/vehicles"
            createPermission="LOGISTICS_CREATE"
            emptyMessage="No vehicles yet."
            columns={[
                { key: 'business_id', label: 'ID', render: (r) => <BusinessIdentifier entityType="VEHICLE" businessId={r.business_id} /> },
                { key: 'vehicle_number', label: 'Number' },
                { key: 'vehicle_type', label: 'Type' },
                { key: 'driver_name', label: 'Driver' },
                { key: 'status', label: 'Status', render: (r) => <Pill status={r.status} /> }
            ]}
            formFields={[
                { name: 'vehicleNumber', label: 'Vehicle number', required: true, fullWidth: true },
                { name: 'vehicleType', label: 'Type', placeholder: 'truck, van, pickup…' },
                { name: 'capacityUnit', label: 'Capacity unit', placeholder: 'ton, cbm…' },
                { name: 'capacityValue', label: 'Capacity value', type: 'number', step: '0.01' },
                { name: 'driverName', label: 'Driver name' },
                { name: 'driverPhone', label: 'Driver phone' }
            ]}
        />
    );
}
