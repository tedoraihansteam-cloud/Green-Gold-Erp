const TONE_MAP = {
    active: 'success', approved: 'success', issued: 'success', exited: 'success', paid: 'success', completed: 'success', clocked_in: 'success',
    pending_approval: 'warning', pending: 'warning', draft: 'warning', assigned: 'warning', in_progress: 'warning', high: 'warning', urgent: 'danger',
    cancelled: 'danger', rejected: 'danger', disabled: 'danger', blocked: 'danger', closed: 'neutral', clocked_out: 'neutral', absent: 'neutral'
};

export default function Pill({ status }) {
    const tone = TONE_MAP[status] || 'neutral';
    return <span className={`pill pill-${tone}`}>{String(status).replace(/_/g, ' ')}</span>;
}
