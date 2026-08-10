import SimpleResourcePage from '../../components/SimpleResourcePage';
import BusinessIdentifier from '../../components/BusinessIdentifier';

export default function RentalPoliciesPage() {
    return (
        <SimpleResourcePage
            title="Rental policies"
            entityType="RENTAL_POLICY"
            subtitle="Configurable billing rules — unit rate, cycle, and minimum billing period"
            listPath="/cold-storage/rental-policies"
            listKey="policies"
            createPath="/cold-storage/rental-policies"
            createPermission="COLD_STORAGE_CREATE"
            emptyMessage="No rental policies yet."
            columns={[
                { key: 'business_id', label: 'ID', render: (r) => <BusinessIdentifier entityType="RENTAL_POLICY" businessId={r.business_id} /> },
                { key: 'name', label: 'Name' },
                { key: 'unit_type', label: 'Unit' },
                { key: 'rate_per_unit_per_cycle', label: 'Rate', align: 'right', render: (r) => <span className="num">৳{Number(r.rate_per_unit_per_cycle).toLocaleString()}</span> },
                { key: 'billing_cycle', label: 'Cycle' },
                { key: 'billing_basis', label: 'Billing basis', render:r=>r.billing_basis==='operational_year'?'Operational year (June–May)':'Rolling cycle' },
                { key: 'min_billing_cycles', label: 'Min. cycles', align: 'right', render: (r) => <span className="num">{r.min_billing_cycles}</span> }
            ]}
            formFields={[
                { name: 'name', label: 'Name', required: true, fullWidth: true },
                { name: 'unitType', label: 'Unit type', required: true, placeholder: 'pallet, crate, rack, ton, sqft, cbm, room' },
                { name: 'ratePerUnitPerCycle', label: 'Rate per unit per cycle (৳)', type: 'number', step: '0.01', required: true },
                { name: 'billingCycle', label: 'Billing cycle', type: 'select', required: true, options: [
                    { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }
                ]},
                { name: 'billingBasis', label: 'Billing basis', type: 'select', required: true, default: 'rolling', options: [{value:'rolling',label:'Rolling cycle from receiving date'},{value:'operational_year',label:'Operational year: June 1 to May 31'}]},
                { name: 'minBillingCycles', label: 'Minimum cycles billed', type: 'number', default: '1', hint: 'e.g. 1 with monthly billing = 1-month minimum charge' },
                { name: 'taxPercent', label: 'Tax %', type: 'number', step: '0.01', default: '0' }
            ]}
        />
    );
}
