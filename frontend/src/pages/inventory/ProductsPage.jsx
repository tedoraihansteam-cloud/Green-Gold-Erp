import SimpleResourcePage from '../../components/SimpleResourcePage';
import BusinessIdentifier from '../../components/BusinessIdentifier';

export default function ProductsPage() {
    return <SimpleResourcePage title="Products" entityType="PRODUCT" subtitle="Product master, stock and default rental value" listPath="/inventory/products" listKey="products" createPath="/inventory/products" createPermission="INVENTORY_CREATE" emptyMessage="No products yet."
        columns={[
            {key:'business_id',label:'ID',render:r=><BusinessIdentifier entityType="PRODUCT" businessId={r.business_id}/>},
            {key:'name',label:'Name'},{key:'category',label:'Category'},{key:'unit',label:'Unit'},
            {key:'unit_price',label:'Unit price',align:'right',render:r=><span className="num">৳{Number(r.unit_price).toLocaleString()}</span>},
            {key:'monthly_rent_per_unit',label:'Rent / unit / month',align:'right',render:r=><span className="num">৳{Number(r.monthly_rent_per_unit||0).toLocaleString()}</span>},
            {key:'total_stock',label:'In stock',align:'right',render:r=><span className="num">{Number(r.total_stock).toLocaleString()}</span>}
        ]}
        formFields={[
            {name:'name',label:'Name',required:true,fullWidth:true},{name:'sku',label:'SKU'},{name:'category',label:'Category'},
            {name:'unit',label:'Unit',default:'pcs',hint:'e.g. bag, kg, ton, pcs, litre'},
            {name:'unitPrice',label:'Unit price (৳)',type:'number',step:'0.01'},
            {name:'monthlyRentPerUnit',label:'Default rent per unit/month (৳)',type:'number',step:'0.01',hint:'A customer contract or receiving entry can override this value'},
            {name:'reorderLevel',label:'Reorder level',type:'number',step:'0.01'}
        ]}/>;
}
