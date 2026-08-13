import { useEffect, useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import Pill from '../../components/Pill';

const EMPTY_LOCATION = { mode: 'office', latitude: '', longitude: '', locationAddress: '', notes: '' };
const EMPTY_TASK = { title: '', description: '', assigneeUserId: '', priority: 'normal', dueDate: '' };

function formatDuration(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(total / 60);
    const remainder = total % 60;
    return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function liveMinutes(startedAt, now) {
    return startedAt ? Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60000)) : 0;
}

function LocationView({ latitude, longitude, address }) {
    if (latitude == null || longitude == null) return address || '—';
    const coordinates = `${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}`;
    return <div>{address ? <div>{address}</div> : null}<a href={`https://www.google.com/maps?q=${latitude},${longitude}`} target="_blank" rel="noreferrer">{coordinates} · Open map</a></div>;
}

export default function WorkforcePage() {
    const { can } = useAuth();
    const isHrViewer = can('HR_VIEW');
    const [teamDate, setTeamDate] = useState(new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0, 10));
    const { data, loading, error, reload } = useApi('/workforce/me');
    const { data: teamData, reload: reloadTeam } = useApi(isHrViewer ? `/workforce/team?date=${teamDate}` : null);
    const [attendanceForm, setAttendanceForm] = useState(EMPTY_LOCATION);
    const [locationMessage, setLocationMessage] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [now, setNow] = useState(Date.now());
    const [showTask, setShowTask] = useState(false);
    const [taskForm, setTaskForm] = useState(EMPTY_TASK);
    const [editingTask, setEditingTask] = useState(null);
    const [taskUpdate, setTaskUpdate] = useState({ status: 'assigned', progressPercent: 0 });
    const [reportingTask, setReportingTask] = useState(null);
    const [taskReport, setTaskReport] = useState({ status: 'in_progress', progressPercent: 0, workSummary: '', blockers: '', nextActions: '' });

    useEffect(() => {
        const timer = window.setInterval(() => {
            setNow(Date.now());
            reload();
            if (isHrViewer) reloadTeam();
        }, 60000);
        return () => window.clearInterval(timer);
    }, [isHrViewer, reload, reloadTeam]);

    function refreshAll() {
        reload();
        if (isHrViewer) reloadTeam();
        window.dispatchEvent(new Event('ggerp:workforce-updated'));
    }

    function captureLocation() {
        if (!navigator.geolocation) {
            setLocationMessage('Location capture is not supported by this browser. IP and entered address will still be recorded.');
            return;
        }
        setLocationMessage('Requesting location permission…');
        navigator.geolocation.getCurrentPosition(
            (position) => {
                setAttendanceForm((current) => ({
                    ...current,
                    latitude: position.coords.latitude.toFixed(7),
                    longitude: position.coords.longitude.toFixed(7),
                }));
                setLocationMessage(`GPS captured with approximately ${Math.round(position.coords.accuracy)} m accuracy.`);
            },
            (locationError) => setLocationMessage(`GPS not captured: ${locationError.message}. IP and entered address will still be recorded.`),
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
        );
    }

    async function attendanceAction(action) {
        setBusy(true);
        setMessage('');
        try {
            const result=await api.post(`/workforce/attendance/${action}`, attendanceForm);
            setMessage(result.message || (action === 'clock-in' ? 'Attendance started successfully.' : 'Attendance closed successfully.'));
            refreshAll();
        } catch (actionError) {
            setMessage(actionError.message);
        } finally {
            setBusy(false);
        }
    }

    async function taskAction(task, action) {
        setBusy(true);
        setMessage('');
        try {
            await api.post(`/workforce/tasks/${task.business_id}/${action}`, {
                latitude: attendanceForm.latitude || undefined,
                longitude: attendanceForm.longitude || undefined,
                locationAddress: attendanceForm.locationAddress || undefined,
            });
            setMessage(action === 'start' ? `Started ${task.title}.` : `Stopped ${task.title}.`);
            refreshAll();
        } catch (actionError) {
            setMessage(actionError.message);
        } finally {
            setBusy(false);
        }
    }

    function openTaskUpdate(task) {
        setEditingTask(task);
        setTaskUpdate({ status: task.status, progressPercent: Number(task.progress_percent) });
    }

    async function saveTaskUpdate() {
        setBusy(true);
        setMessage('');
        try {
            await api.put(`/workforce/tasks/${editingTask.business_id}`, taskUpdate);
            setEditingTask(null);
            refreshAll();
        } catch (updateError) {
            setMessage(updateError.message);
        } finally {
            setBusy(false);
        }
    }

    function openTaskReport(task) {
        setReportingTask(task);
        setTaskReport({ status: task.status === 'assigned' ? 'in_progress' : task.status, progressPercent: Number(task.progress_percent), workSummary: '', blockers: '', nextActions: '' });
    }

    async function submitTaskReport() {
        setBusy(true); setMessage('');
        try {
            await api.post(`/workforce/tasks/${reportingTask.business_id}/reports`, taskReport);
            setReportingTask(null);
            setMessage('Task report submitted successfully.');
            refreshAll();
        } catch (reportError) { setMessage(reportError.message); }
        finally { setBusy(false); }
    }

    async function createTask(event) {
        event.preventDefault();
        setBusy(true);
        setMessage('');
        try {
            await api.post('/workforce/tasks', taskForm);
            setTaskForm(EMPTY_TASK);
            setShowTask(false);
            setMessage('Task assigned successfully.');
            refreshAll();
        } catch (createError) {
            setMessage(createError.message);
        } finally {
            setBusy(false);
        }
    }

    const currentMinutes = liveMinutes(data?.currentSession?.clock_in_at, now);
    const activeTaskMinutes = liveMinutes(data?.activeTask?.started_at, now);
    const openTasks = (data?.tasks || []).filter((task) => !['completed', 'cancelled'].includes(task.status));

    const myTaskColumns = [
        { key: 'business_id', label: 'Task' },
        { key: 'title', label: 'Title' },
        { key: 'priority', label: 'Priority', render: (task) => <Pill status={task.priority} /> },
        { key: 'due_date', label: 'Due', render: (task) => task.due_date ? new Date(task.due_date).toLocaleDateString() : '—' },
        { key: 'progress_percent', label: 'Progress', render: (task) => `${task.progress_percent}%` },
        { key: 'logged_minutes', label: 'Task time', render: (task) => formatDuration(Number(task.logged_minutes) + (data?.activeTask?.business_id === task.business_id ? activeTaskMinutes : 0)) },
        { key: 'status', label: 'Status', render: (task) => <Pill status={task.status} /> },
        {
            key: 'actions', label: '', render: (task) => (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {data?.activeTask?.business_id === task.business_id ? (
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => taskAction(task, 'stop')}>Stop timer</button>
                    ) : !['completed', 'cancelled'].includes(task.status) ? (
                        <button type="button" className="btn btn-primary btn-sm" disabled={busy || Boolean(data?.activeTask)} onClick={() => taskAction(task, 'start')}>Start work</button>
                    ) : null}
                    {!['completed', 'cancelled'].includes(task.status) ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => openTaskUpdate(task)}>Update</button> : null}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => openTaskReport(task)}>Submit task report</button>
                </div>
            ),
        },
    ];

    return (
        <div>
            <div className="card-header" style={{ marginBottom: 18 }}>
                <div>
                    <h1 className="page-title">Attendance & task workspace</h1>
                    <p className="card-subtitle">Daily attendance, task-wise work time, IP, work mode, and optional GPS/location evidence.</p>
                </div>
                {isHrViewer && can('HR_CREATE') ? <button type="button" className="btn btn-primary" onClick={() => setShowTask(true)}>Assign task</button> : null}
            </div>

            {error ? <div className="error-banner">{error}</div> : null}
            {message ? <div className={/success|assigned|started|stopped|closed/i.test(message) ? 'success-banner' : 'error-banner'}>{message}</div> : null}
            {data?.currentSession&&new Date(data.currentSession.attendance_date).toDateString()!==new Date().toDateString()?<div className="error-banner">An earlier attendance session is still open from {new Date(data.currentSession.clock_in_at).toLocaleString()}. Clock out to close it before starting a new session.</div>:null}
            {data?.attendancePolicy?<div className="info-banner">Counted attendance window: {data.attendancePolicy.start}–{data.attendancePolicy.end} ({data.attendancePolicy.timezone}). Clock actions outside the window are retained but not counted.</div>:null}

            {!loading ? (
                <div className="stat-grid">
                    <div className="stat-card"><div className="label">Today</div><div className="value">{data?.currentSession ? formatDuration(currentMinutes) : data?.today?.length ? 'Completed' : 'Not started'}</div></div>
                    <div className="stat-card"><div className="label">Present days this month</div><div className="value">{data?.monthSummary?.present_days || 0}</div></div>
                    <div className="stat-card"><div className="label">Hours this month</div><div className="value">{Number(data?.monthSummary?.total_hours || 0).toFixed(1)}</div></div>
                    <div className="stat-card"><div className="label">Open tasks</div><div className="value">{openTasks.length}</div></div>
                </div>
            ) : null}

            <section className="card" style={{ marginBottom: 18 }}>
                <div className="card-header"><div><h2>My attendance</h2><p className="card-subtitle">The server records your IP automatically. GPS and written address are optional evidence.</p></div></div>
                <div className="form-grid">
                    <div className="field">
                        <label htmlFor="attendance-mode">Attendance mode</label>
                        <select id="attendance-mode" value={attendanceForm.mode} onChange={(event) => setAttendanceForm((current) => ({ ...current, mode: event.target.value }))}>
                            <option value="office">Office</option><option value="field">Field / site</option><option value="remote">Remote</option><option value="device">Device / QR terminal</option><option value="manual">Authorized manual entry</option>
                        </select>
                    </div>
                    <div className="field">
                        <label htmlFor="work-address">Work location / address</label>
                        <input id="work-address" value={attendanceForm.locationAddress} onChange={(event) => setAttendanceForm((current) => ({ ...current, locationAddress: event.target.value }))} placeholder="Office, factory, warehouse or site" />
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-secondary" onClick={captureLocation}>Capture current GPS</button>
                    {locationMessage ? <span className="hint">{locationMessage}</span> : null}
                </div>
                {attendanceForm.latitude && attendanceForm.longitude ? <div className="success-banner" style={{ marginTop: 12 }}><strong>Detected location:</strong> <LocationView latitude={attendanceForm.latitude} longitude={attendanceForm.longitude} address={attendanceForm.locationAddress} /></div> : null}
                <div className="form-actions">
                    {data?.currentSession ? (
                        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => attendanceAction('clock-out')}>Clock out</button>
                    ) : (
                        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => attendanceAction('clock-in')}>Clock in</button>
                    )}
                </div>
            </section>

            <section className="card" style={{ marginBottom: 18 }}>
                <div className="card-header"><div><h2>My task bar</h2><p className="card-subtitle">Start a task timer after clocking in. Task time is counted inside the attendance session.</p></div></div>
                <DataTable rows={data?.tasks || []} columns={myTaskColumns} keyField="business_id" emptyMessage="No task has been assigned." />
            </section>

            <section className="card" style={{ marginBottom: 18 }}>
                <h2>My recent attendance</h2>
                <DataTable
                    rows={data?.recentAttendance || []}
                    keyField="attendance_date"
                    columns={[
                        { key: 'attendance_date', label: 'Date', render: (row) => new Date(row.attendance_date).toLocaleDateString() },
                        { key: 'first_in', label: 'First in', render: (row) => new Date(row.first_in).toLocaleTimeString() },
                        { key: 'last_out', label: 'Last out', render: (row) => row.last_out ? new Date(row.last_out).toLocaleTimeString() : 'Active' },
                        { key: 'hours', label: 'Hours' },
                        { key: 'modes', label: 'Mode' },
                        { key: 'location_address', label: 'Location', render: (row) => <LocationView latitude={row.latitude} longitude={row.longitude} address={row.location_address} /> },
                    ]}
                />
            </section>

            {isHrViewer ? (
                <>
                    <section className="card" style={{ marginBottom: 18 }}>
                        <div className="card-header">
                            <div><h2>Team attendance</h2><p className="card-subtitle">Live daily status for every active staff login.</p></div>
                            <div className="field" style={{ margin: 0 }}><label htmlFor="team-date">Date</label><input id="team-date" type="date" value={teamDate} onChange={(event) => setTeamDate(event.target.value)} /></div>
                        </div>
                        <DataTable
                            rows={teamData?.attendance || []}
                            keyField="user_id"
                            columns={[
                                { key: 'staff_name', label: 'Staff' },
                                { key: 'employee_business_id', label: 'Employee ID' },
                                { key: 'status', label: 'Status', render: (row) => <Pill status={row.status} /> },
                                { key: 'latest_work_summary', label: 'Latest task report', render: (row) => row.latest_work_summary || '—' },
                                { key: 'latest_blockers', label: 'Blockers', render: (row) => row.latest_blockers || '—' },
                                { key: 'latest_next_actions', label: 'Next action', render: (row) => row.latest_next_actions || '—' },
                                { key: 'latest_report_at', label: 'Reported at', render: (row) => row.latest_report_at ? new Date(row.latest_report_at).toLocaleString() : '—' },
                                { key: 'first_in', label: 'First in', render: (row) => row.first_in ? new Date(row.first_in).toLocaleTimeString() : '—' },
                                { key: 'last_out', label: 'Last out', render: (row) => row.last_out ? new Date(row.last_out).toLocaleTimeString() : '—' },
                                { key: 'hours', label: 'Hours' },
                                { key: 'modes', label: 'Mode' },
                                { key: 'clock_in_ip', label: 'IP address' },
                                { key: 'location_address', label: 'Location / GPS', render: (row) => <LocationView latitude={row.latitude} longitude={row.longitude} address={row.location_address} /> },
                            ]}
                        />
                    </section>
                    <section className="card">
                        <h2>All staff tasks</h2>
                        <DataTable
                            rows={teamData?.tasks || []}
                            keyField="business_id"
                            columns={[
                                { key: 'business_id', label: 'Task' },{ key: 'title', label: 'Title' },{ key: 'assignee_name', label: 'Assigned to' },
                                { key: 'priority', label: 'Priority', render: (row) => <Pill status={row.priority} /> },
                                { key: 'due_date', label: 'Due', render: (row) => row.due_date ? new Date(row.due_date).toLocaleDateString() : '—' },
                                { key: 'progress_percent', label: 'Progress', render: (row) => `${row.progress_percent}%` },
                                { key: 'logged_minutes', label: 'Task time', render: (row) => formatDuration(row.logged_minutes) },
                                { key: 'status', label: 'Status', render: (row) => <Pill status={row.status} /> },
                            ]}
                        />
                    </section>
                </>
            ) : null}

            {showTask ? (
                <Modal title="Assign staff task" onClose={() => setShowTask(false)}>
                    <form onSubmit={createTask}>
                        <div className="field"><label htmlFor="task-title">Task title *</label><input id="task-title" required value={taskForm.title} onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))} /></div>
                        <div className="field"><label htmlFor="task-assignee">Assign to *</label><select id="task-assignee" required value={taskForm.assigneeUserId} onChange={(event) => setTaskForm((current) => ({ ...current, assigneeUserId: event.target.value }))}><option value="">Select staff…</option>{(teamData?.staff || []).map((staff) => <option key={staff.id} value={staff.id}>{staff.name} ({staff.username})</option>)}</select></div>
                        <div className="form-grid">
                            <div className="field"><label htmlFor="task-priority">Priority</label><select id="task-priority" value={taskForm.priority} onChange={(event) => setTaskForm((current) => ({ ...current, priority: event.target.value }))}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
                            <div className="field"><label htmlFor="task-due">Due date</label><input id="task-due" type="date" value={taskForm.dueDate} onChange={(event) => setTaskForm((current) => ({ ...current, dueDate: event.target.value }))} /></div>
                        </div>
                        <div className="field"><label htmlFor="task-description">Instructions</label><textarea id="task-description" rows="4" value={taskForm.description} onChange={(event) => setTaskForm((current) => ({ ...current, description: event.target.value }))} /></div>
                        <div className="form-actions"><button type="button" className="btn btn-secondary" onClick={() => setShowTask(false)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Assigning…' : 'Assign task'}</button></div>
                    </form>
                </Modal>
            ) : null}

            {editingTask ? (
                <Modal title={`Update — ${editingTask.title}`} onClose={() => setEditingTask(null)}>
                    <div className="field"><label htmlFor="task-status">Status</label><select id="task-status" value={taskUpdate.status} onChange={(event) => setTaskUpdate((current) => ({ ...current, status: event.target.value }))}><option value="assigned">Assigned</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="completed">Completed</option></select></div>
                    <div className="field"><label htmlFor="task-progress">Progress: {taskUpdate.progressPercent}%</label><input id="task-progress" type="range" min="0" max="100" step="5" value={taskUpdate.progressPercent} onChange={(event) => setTaskUpdate((current) => ({ ...current, progressPercent: Number(event.target.value) }))} /></div>
                    <div className="form-actions"><button type="button" className="btn btn-secondary" onClick={() => setEditingTask(null)}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={saveTaskUpdate}>Save update</button></div>
                </Modal>
            ) : null}
            {reportingTask ? (
                <Modal title={`Submit task report — ${reportingTask.title}`} onClose={() => setReportingTask(null)}>
                    <p className="card-subtitle">Report completed work, current progress, blockers and the next planned action. Each submission is preserved in report history.</p>
                    <div className="form-grid"><div className="field"><label>Status</label><select value={taskReport.status} onChange={e=>setTaskReport(v=>({...v,status:e.target.value}))}><option value="assigned">Assigned</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="completed">Completed</option></select></div><div className="field"><label>Progress: {taskReport.progressPercent}%</label><input type="range" min="0" max="100" step="5" value={taskReport.progressPercent} onChange={e=>setTaskReport(v=>({...v,progressPercent:Number(e.target.value)}))}/></div></div>
                    <div className="field"><label>Completed-work report *</label><textarea rows="5" required value={taskReport.workSummary} onChange={e=>setTaskReport(v=>({...v,workSummary:e.target.value}))} placeholder="Describe work completed, result, quantities or outcome" /></div>
                    <div className="field"><label>Problems / blockers</label><textarea rows="3" value={taskReport.blockers} onChange={e=>setTaskReport(v=>({...v,blockers:e.target.value}))} placeholder="Mention delays, missing approvals, materials or support needed" /></div>
                    <div className="field"><label>Next action</label><textarea rows="3" value={taskReport.nextActions} onChange={e=>setTaskReport(v=>({...v,nextActions:e.target.value}))} placeholder="State the next planned step and expected completion" /></div>
                    <div className="form-actions"><button type="button" className="btn btn-secondary" onClick={()=>setReportingTask(null)}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy||!taskReport.workSummary.trim()} onClick={submitTaskReport}>{busy?'Submitting…':'Submit report'}</button></div>
                </Modal>
            ) : null}
        </div>
    );
}
