const { query } = require('../config/db');
const { getNoticesForUser } = require('../services/notificationService');

/**
 * Minimal Phase 1 dashboard - just proves the API foundation end-to-end.
 * Real KPI widgets (sales trends, cash position, occupancy, etc.) get
 * added as their source modules are built.
 */
async function summary(req, res) {
    const companyId = req.user.company_id;

    const [customers, vendors, employees, pendingApprovals, unreadNotices] = await Promise.all([
        query(`SELECT count(*) FROM master_customers WHERE company_id = $1 AND deleted_at IS NULL`, [companyId]),
        query(`SELECT count(*) FROM master_vendors WHERE company_id = $1 AND deleted_at IS NULL`, [companyId]),
        query(`SELECT count(*) FROM master_employees WHERE company_id = $1 AND deleted_at IS NULL`, [companyId]),
        query(`SELECT count(*) FROM link_requests lr JOIN users u ON u.id=lr.requesting_user_id WHERE u.company_id = $1 AND lr.status = 'pending'`, [companyId]),
        getNoticesForUser(req.user.id)
    ]);

    let workforce = null;
    if (req.user.account_type === 'staff') {
        const [attendance, monthAttendance, tasks] = await Promise.all([
            query(
                `SELECT clock_in_at FROM staff_attendance_sessions
                 WHERE user_id=$1 AND clock_out_at IS NULL LIMIT 1`,
                [req.user.id]
            ),
            query(
                `SELECT COUNT(DISTINCT attendance_date)::int AS present_days,
                        ROUND((COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(clock_out_at,now())-clock_in_at))),0)/3600)::numeric,2) AS hours
                 FROM staff_attendance_sessions
                 WHERE user_id=$1 AND date_trunc('month',attendance_date)=date_trunc('month',CURRENT_DATE)`,
                [req.user.id]
            ),
            query(
                `SELECT COUNT(*)::int AS open_tasks
                 FROM staff_tasks
                 WHERE assignee_user_id=$1 AND status NOT IN ('completed','cancelled')`,
                [req.user.id]
            ),
        ]);
        workforce = {
            clockedIn: Boolean(attendance.rows[0]),
            clockInAt: attendance.rows[0]?.clock_in_at || null,
            presentDays: monthAttendance.rows[0].present_days,
            monthHours: Number(monthAttendance.rows[0].hours),
            openTasks: tasks.rows[0].open_tasks,
        };
    }

    res.json({
        customers: Number(customers.rows[0].count),
        vendors: Number(vendors.rows[0].count),
        employees: Number(employees.rows[0].count),
        pendingApprovals: Number(pendingApprovals.rows[0].count),
        unreadNotices: unreadNotices.filter((notice) => !notice.read_at).length,
        workforce,
    });
}

module.exports = { summary };
