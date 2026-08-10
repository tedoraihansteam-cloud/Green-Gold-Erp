import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/useApi';

export default function StaffTaskBar() {
    const { data, reload } = useApi('/workforce/me');

    useEffect(() => {
        const timer = window.setInterval(reload, 60000);
        window.addEventListener('ggerp:workforce-updated', reload);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('ggerp:workforce-updated', reload);
        };
    }, [reload]);

    const openTasks = (data?.tasks || []).filter((task) => !['completed', 'cancelled'].includes(task.status)).length;
    return (
        <Link
            to="/staff-workspace"
            className="btn btn-secondary btn-sm"
            style={{ textDecoration: 'none', display: 'inline-flex', gap: 7, alignItems: 'center' }}
            title="Open attendance and task workspace"
        >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: data?.currentSession ? 'var(--moss-600)' : 'var(--ink-400)' }} />
            {data?.currentSession ? 'Clocked in' : 'Not clocked in'}
            <span aria-hidden="true">·</span>
            {data?.activeTask ? `Working: ${data.activeTask.title}` : `${openTasks} open tasks`}
        </Link>
    );
}
