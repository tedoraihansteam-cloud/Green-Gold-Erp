export default function DataTable({ columns, rows, keyField = 'id', emptyMessage = 'No records yet.' }) {
    return (
        <div className="table-wrap">
            <table className="data">
                <thead>
                    <tr>
                        {columns.map((c) => (
                            <th key={c.key} style={c.align === 'right' ? { textAlign: 'right' } : undefined}>{c.label}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 && (
                        <tr className="empty-row"><td colSpan={columns.length}>{emptyMessage}</td></tr>
                    )}
                    {rows.map((row) => (
                        <tr key={row[keyField]}>
                            {columns.map((c) => (
                                <td key={c.key} className={c.className}>
                                    {c.render ? c.render(row) : row[c.key]}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
