const { query, withTransaction } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { logAction } = require('../services/auditLogger');

const ATTENDANCE_MODES = new Set(['office', 'field', 'remote', 'device', 'manual']);
const TASK_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const TASK_STATUSES = new Set(['assigned', 'in_progress', 'blocked', 'completed', 'cancelled']);
function dhakaMonth(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit'}).formatToParts(new Date());return `${parts.find(p=>p.type==='year').value}-${parts.find(p=>p.type==='month').value}`;}

function clientIp(req) {
    return req.ip || req.socket?.remoteAddress || null;
}

function locationValues(body) {
    const latitude = body.latitude === '' || body.latitude == null ? null : Number(body.latitude);
    const longitude = body.longitude === '' || body.longitude == null ? null : Number(body.longitude);
    if (latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
        throw Object.assign(new Error('Invalid latitude'), { statusCode: 400 });
    }
    if (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
        throw Object.assign(new Error('Invalid longitude'), { statusCode: 400 });
    }
    return { latitude, longitude, locationAddress: body.locationAddress || null };
}

async function myWorkspace(req, res) {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '')
        ? req.query.month
        : dhakaMonth();
    const [today, openAttendance, monthSummary, tasks, activeTask, recentAttendance] = await Promise.all([
        query(
            `SELECT *, ROUND((EXTRACT(EPOCH FROM (COALESCE(clock_out_at,now())-clock_in_at))/3600)::numeric,2) AS hours
             FROM staff_attendance_sessions
             WHERE user_id=$1 AND attendance_date=CURRENT_DATE
             ORDER BY clock_in_at`,
            [req.user.id]
        ),
        query(
            `SELECT *,ROUND((EXTRACT(EPOCH FROM (now()-clock_in_at))/3600)::numeric,2) AS hours
             FROM staff_attendance_sessions
             WHERE user_id=$1 AND company_id=$2 AND clock_out_at IS NULL
             ORDER BY clock_in_at DESC LIMIT 1`,
            [req.user.id,req.user.company_id]
        ),
        query(
            `SELECT COUNT(DISTINCT attendance_date)::int AS present_days,
                    ROUND((COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(clock_out_at,now())-clock_in_at))),0)/3600)::numeric,2) AS total_hours
             FROM staff_attendance_sessions
             WHERE user_id=$1 AND to_char(attendance_date,'YYYY-MM')=$2`,
            [req.user.id, month]
        ),
        query(
            `SELECT t.business_id,t.title,t.description,t.priority,t.status,t.progress_percent,t.due_date,t.created_at,
                    creator.username AS assigned_by_name,lr.business_id AS latest_report_id,lr.work_summary AS latest_work_summary,lr.blockers AS latest_blockers,lr.next_actions AS latest_next_actions,lr.created_at AS latest_report_at,
                    ROUND((COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(te.stopped_at,now())-te.started_at))),0)/60)::numeric,0)::int AS logged_minutes
             FROM staff_tasks t
             JOIN users creator ON creator.id=t.assigned_by
             LEFT JOIN staff_task_time_entries te ON te.task_id=t.id
             LEFT JOIN LATERAL (SELECT * FROM staff_task_reports r WHERE r.task_id=t.id ORDER BY r.created_at DESC LIMIT 1) lr ON true
             WHERE t.assignee_user_id=$1 AND t.status<>'cancelled'
             GROUP BY t.id,creator.username,lr.business_id,lr.work_summary,lr.blockers,lr.next_actions,lr.created_at
             ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'assigned' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END,
                      t.due_date NULLS LAST,t.created_at DESC`,
            [req.user.id]
        ),
        query(
            `SELECT te.id,t.business_id,t.title,te.started_at
             FROM staff_task_time_entries te
             JOIN staff_tasks t ON t.id=te.task_id
             WHERE te.user_id=$1 AND te.stopped_at IS NULL LIMIT 1`,
            [req.user.id]
        ),
        query(
            `SELECT attendance_date,MIN(clock_in_at) AS first_in,MAX(clock_out_at) AS last_out,
                    string_agg(DISTINCT attendance_mode,', ' ORDER BY attendance_mode) AS modes,
                    ROUND((SUM(EXTRACT(EPOCH FROM (COALESCE(clock_out_at,now())-clock_in_at))/3600))::numeric,2) AS hours,
                    MAX(location_address) AS location_address,MAX(latitude) AS latitude,MAX(longitude) AS longitude
             FROM staff_attendance_sessions
             WHERE user_id=$1
             GROUP BY attendance_date ORDER BY attendance_date DESC LIMIT 31`,
            [req.user.id]
        ),
    ]);

    res.json({
        today: today.rows,
        currentSession: openAttendance.rows[0] || null,
        month,
        monthSummary: monthSummary.rows[0],
        tasks: tasks.rows,
        activeTask: activeTask.rows[0] || null,
        recentAttendance: recentAttendance.rows,
    });
}

async function clockIn(req, res) {
    const mode = ATTENDANCE_MODES.has(req.body.mode) ? req.body.mode : 'office';
    const location = locationValues(req.body);
    await query(
        `UPDATE staff_attendance_sessions
         SET clock_out_at=clock_in_at + interval '18 hours',duration_exception=true,
             notes=concat_ws(' | ',NULLIF(notes,''),'Automatically closed after 18-hour attendance limit')
         WHERE user_id=$1 AND company_id=$2 AND clock_out_at IS NULL
           AND clock_in_at < now() - interval '18 hours'`,
        [req.user.id, req.user.company_id]
    );
    try {
        const { rows } = await query(
            `INSERT INTO staff_attendance_sessions(
               company_id,user_id,attendance_mode,clock_in_ip,latitude,longitude,location_address,notes
             ) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [
                req.user.company_id,
                req.user.id,
                mode,
                clientIp(req),
                location.latitude,
                location.longitude,
                location.locationAddress,
                req.body.notes || null,
            ]
        );
        await logAction({ actorUserId: req.user.id, action: 'ATTENDANCE_CLOCK_IN', entityType: 'ATTENDANCE', entityId: rows[0].id, after: { mode, ip: clientIp(req), ...location } });
        return res.status(201).json({ session: rows[0] });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'You are already clocked in' });
        throw error;
    }
}

async function clockOut(req, res) {
    const location = locationValues(req.body);
    const result = await withTransaction(async (client) => {
        const { rows } = await client.query(
            `UPDATE staff_attendance_sessions
             SET clock_out_at=now(),clock_out_ip=$1,
                 latitude=COALESCE($2,latitude),longitude=COALESCE($3,longitude),
                 location_address=COALESCE($4,location_address)
             WHERE user_id=$5 AND company_id=$6 AND clock_out_at IS NULL
             RETURNING *`,
            [clientIp(req), location.latitude, location.longitude, location.locationAddress, req.user.id, req.user.company_id]
        );
        if (!rows.length) throw Object.assign(new Error('No active attendance session found'), { statusCode: 409 });
        await client.query(
            `UPDATE staff_task_time_entries SET stopped_at=now()
             WHERE user_id=$1 AND stopped_at IS NULL`,
            [req.user.id]
        );
        return rows[0];
    });
    await logAction({ actorUserId: req.user.id, action: 'ATTENDANCE_CLOCK_OUT', entityType: 'ATTENDANCE', entityId: result.id, after: { ip: clientIp(req), ...location } });
    res.json({ session: result });
}

async function createTask(req, res) {
    const { title, description, assigneeUserId, priority, dueDate } = req.body;
    if (!title || !assigneeUserId) return res.status(400).json({ error: 'title and assigneeUserId are required' });
    const normalizedPriority = TASK_PRIORITIES.has(priority) ? priority : 'normal';
    const { rows: assignees } = await query(
        `SELECT id FROM users
         WHERE id=$1 AND company_id=$2 AND account_type='staff' AND status='active' AND deleted_at IS NULL`,
        [assigneeUserId, req.user.company_id]
    );
    if (!assignees.length) return res.status(404).json({ error: 'Active staff user not found' });
    const businessId = await generateNextId('STAFF_TASK');
    const { rows } = await query(
        `INSERT INTO staff_tasks(
           business_id,company_id,title,description,assignee_user_id,assigned_by,priority,due_date
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [businessId, req.user.company_id, title, description || null, assigneeUserId, req.user.id, normalizedPriority, dueDate || null]
    );
    await logAction({ actorUserId: req.user.id, action: 'STAFF_TASK_ASSIGNED', entityType: 'STAFF_TASK', entityId: businessId, after: rows[0] });
    res.status(201).json({ task: rows[0] });
}

async function startTask(req, res) {
    const location = locationValues(req.body);
    try {
        const result = await withTransaction(async (client) => {
            const { rows: tasks } = await client.query(
                `SELECT * FROM staff_tasks
                 WHERE business_id=$1 AND company_id=$2 AND assignee_user_id=$3
                   AND status NOT IN ('completed','cancelled') FOR UPDATE`,
                [req.params.businessId, req.user.company_id, req.user.id]
            );
            if (!tasks.length) throw Object.assign(new Error('Assigned open task not found'), { statusCode: 404 });
            const { rows: sessions } = await client.query(
                `SELECT id FROM staff_attendance_sessions
                 WHERE user_id=$1 AND attendance_date=CURRENT_DATE AND clock_out_at IS NULL LIMIT 1`,
                [req.user.id]
            );
            if (!sessions.length) throw Object.assign(new Error('Clock in before starting task work'), { statusCode: 409 });
            const { rows: entries } = await client.query(
                `INSERT INTO staff_task_time_entries(
                   company_id,task_id,user_id,attendance_session_id,ip_address,
                   latitude,longitude,location_address,notes
                 ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
                [req.user.company_id, tasks[0].id, req.user.id, sessions[0].id, clientIp(req), location.latitude, location.longitude, location.locationAddress, req.body.notes || null]
            );
            await client.query(
                `UPDATE staff_tasks SET status='in_progress',updated_at=now() WHERE id=$1`,
                [tasks[0].id]
            );
            return { entry: entries[0], task: tasks[0] };
        });
        await logAction({ actorUserId: req.user.id, action: 'STAFF_TASK_STARTED', entityType: 'STAFF_TASK', entityId: result.task.business_id, after: { ip: clientIp(req), ...location } });
        return res.status(201).json({ entry: result.entry });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Stop your active task before starting another task' });
        throw error;
    }
}

async function stopTask(req, res) {
    const { rows } = await query(
        `UPDATE staff_task_time_entries te SET stopped_at=now()
         FROM staff_tasks t
         WHERE te.task_id=t.id AND t.business_id=$1 AND t.company_id=$2
           AND te.user_id=$3 AND te.stopped_at IS NULL
         RETURNING te.*`,
        [req.params.businessId, req.user.company_id, req.user.id]
    );
    if (!rows.length) return res.status(409).json({ error: 'This task is not currently running' });
    await logAction({ actorUserId: req.user.id, action: 'STAFF_TASK_STOPPED', entityType: 'STAFF_TASK', entityId: req.params.businessId });
    res.json({ entry: rows[0] });
}

async function updateTask(req, res) {
    const progress = req.body.progressPercent == null ? null : Number(req.body.progressPercent);
    if (progress != null && (!Number.isInteger(progress) || progress < 0 || progress > 100)) {
        return res.status(400).json({ error: 'progressPercent must be a whole number from 0 to 100' });
    }
    const requestedStatus = req.body.status;
    if (requestedStatus && !TASK_STATUSES.has(requestedStatus)) return res.status(400).json({ error: 'Invalid task status' });
    const status = progress === 100 ? 'completed' : requestedStatus;
    const { rows } = await query(
        `UPDATE staff_tasks
         SET progress_percent=COALESCE($1,progress_percent),
             status=COALESCE($2,status),
             completed_at=CASE WHEN COALESCE($2,status)='completed' THEN COALESCE(completed_at,now()) ELSE NULL END,
             updated_at=now()
         WHERE business_id=$3 AND company_id=$4
           AND (assignee_user_id=$5 OR $6::boolean)
         RETURNING *`,
        [progress, status || null, req.params.businessId, req.user.company_id, req.user.id, req.permissions.has('HR_EDIT')]
    );
    if (!rows.length) return res.status(404).json({ error: 'Task not found or not editable' });
    if (rows[0].status === 'completed') {
        await query(
            `UPDATE staff_task_time_entries SET stopped_at=now()
             WHERE task_id=$1 AND stopped_at IS NULL`,
            [rows[0].id]
        );
    }
    await logAction({ actorUserId: req.user.id, action: 'STAFF_TASK_UPDATED', entityType: 'STAFF_TASK', entityId: req.params.businessId, after: { progressPercent: progress, status: rows[0].status } });
    res.json({ task: rows[0] });
}

async function submitTaskReport(req, res) {
    const progress = Number(req.body.progressPercent);
    const requestedStatus = req.body.status;
    const workSummary = String(req.body.workSummary || '').trim();
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) return res.status(400).json({ error: 'Progress must be a whole number from 0 to 100' });
    if (!TASK_STATUSES.has(requestedStatus) || requestedStatus === 'cancelled') return res.status(400).json({ error: 'Select a valid task report status' });
    if (!workSummary) return res.status(400).json({ error: 'Completed-work summary is required' });
    const result = await withTransaction(async (client) => {
        const { rows: tasks } = await client.query(`SELECT * FROM staff_tasks WHERE business_id=$1 AND company_id=$2 AND (assignee_user_id=$3 OR $4::boolean) FOR UPDATE`, [req.params.businessId, req.user.company_id, req.user.id, req.permissions.has('HR_EDIT')]);
        if (!tasks.length) throw Object.assign(new Error('Task not found or report submission is not permitted'), { statusCode: 404 });
        const status = progress === 100 ? 'completed' : requestedStatus;
        const businessId = await generateNextId('STAFF_TASK_REPORT', client);
        const { rows } = await client.query(`INSERT INTO staff_task_reports(business_id,company_id,task_id,submitted_by,progress_percent,task_status,work_summary,blockers,next_actions) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [businessId, req.user.company_id, tasks[0].id, req.user.id, progress, status, workSummary, req.body.blockers || null, req.body.nextActions || null]);
        await client.query(`UPDATE staff_tasks SET progress_percent=$1,status=$2,completed_at=CASE WHEN $2='completed' THEN COALESCE(completed_at,now()) ELSE NULL END,updated_at=now() WHERE id=$3`, [progress, status, tasks[0].id]);
        if (status === 'completed') await client.query(`UPDATE staff_task_time_entries SET stopped_at=now() WHERE task_id=$1 AND stopped_at IS NULL`, [tasks[0].id]);
        return rows[0];
    });
    await logAction({ actorUserId: req.user.id, action: 'STAFF_TASK_REPORT_SUBMITTED', entityType: 'STAFF_TASK_REPORT', entityId: result.business_id, after: result });
    res.status(201).json({ report: result });
}

async function taskReportHistory(req, res) {
    const { rows } = await query(`SELECT tr.*,u.username submitted_by_name FROM staff_task_reports tr JOIN staff_tasks t ON t.id=tr.task_id JOIN users u ON u.id=tr.submitted_by WHERE t.business_id=$1 AND t.company_id=$2 ORDER BY tr.created_at DESC`, [req.params.businessId, req.user.company_id]);
    res.json({ reports: rows });
}

async function teamOverview(req, res) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null;
    const [attendance, tasks, staff] = await Promise.all([
        query(
            `SELECT u.id AS user_id,u.username,COALESCE(e.full_name,u.display_name,u.username) AS staff_name,
                    e.business_id AS employee_business_id,
                    CASE WHEN COUNT(a.id)>0 THEN CASE WHEN BOOL_OR(a.clock_out_at IS NULL) THEN 'clocked_in' ELSE 'clocked_out' END ELSE 'absent' END AS status,
                    MIN(a.clock_in_at) AS first_in,MAX(a.clock_out_at) AS last_out,
                    ROUND((COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(a.clock_out_at,now())-a.clock_in_at))),0)/3600)::numeric,2) AS hours,
                    string_agg(DISTINCT a.attendance_mode,', ' ORDER BY a.attendance_mode) AS modes,
                    MAX(a.clock_in_ip) AS clock_in_ip,MAX(a.location_address) AS location_address,
                    MAX(a.latitude) AS latitude,MAX(a.longitude) AS longitude
             FROM users u
             LEFT JOIN master_employees e ON e.id=u.linked_employee_id
             LEFT JOIN staff_attendance_sessions a ON a.user_id=u.id AND a.attendance_date=COALESCE($2::date,CURRENT_DATE)
             WHERE u.company_id=$1 AND u.account_type='staff' AND u.status='active' AND u.deleted_at IS NULL
             GROUP BY u.id,e.full_name,e.business_id
             ORDER BY staff_name`,
            [req.user.company_id, date]
        ),
        query(
            `SELECT t.business_id,t.title,t.priority,t.status,t.progress_percent,t.due_date,
                    COALESCE(e.full_name,u.display_name,u.username) AS assignee_name,u.username AS assignee_username,
                    lr.business_id AS latest_report_id,lr.work_summary AS latest_work_summary,lr.blockers AS latest_blockers,lr.next_actions AS latest_next_actions,lr.created_at AS latest_report_at,
                    ROUND((COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(te.stopped_at,now())-te.started_at))),0)/60)::numeric,0)::int AS logged_minutes
             FROM staff_tasks t
             JOIN users u ON u.id=t.assignee_user_id
             LEFT JOIN master_employees e ON e.id=u.linked_employee_id
             LEFT JOIN staff_task_time_entries te ON te.task_id=t.id
             LEFT JOIN LATERAL (SELECT * FROM staff_task_reports r WHERE r.task_id=t.id ORDER BY r.created_at DESC LIMIT 1) lr ON true
             WHERE t.company_id=$1 AND t.status<>'cancelled'
             GROUP BY t.id,u.id,e.full_name,lr.business_id,lr.work_summary,lr.blockers,lr.next_actions,lr.created_at
             ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'assigned' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END,t.due_date NULLS LAST`,
            [req.user.company_id]
        ),
        query(
            `SELECT u.id,u.username,COALESCE(e.full_name,u.display_name,u.username) AS name,e.business_id
             FROM users u LEFT JOIN master_employees e ON e.id=u.linked_employee_id
             WHERE u.company_id=$1 AND u.account_type='staff' AND u.status='active' AND u.deleted_at IS NULL
             ORDER BY name`,
            [req.user.company_id]
        ),
    ]);
    res.json({ date: date || new Date().toISOString().slice(0, 10), attendance: attendance.rows, tasks: tasks.rows, staff: staff.rows });
}

module.exports = { myWorkspace, clockIn, clockOut, createTask, startTask, stopTask, updateTask, submitTaskReport, taskReportHistory, teamOverview };
