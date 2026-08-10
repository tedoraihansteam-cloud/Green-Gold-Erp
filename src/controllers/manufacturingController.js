const { query, withTransaction } = require('../config/db');
const { generateNextId } = require('../services/numberingEngine');
const { generateForEntity, generateForEntitySafe } = require('../services/qrBarcodeService');
const { logAction } = require('../services/auditLogger');

const INCIDENT_TYPES = ['BREAKDOWN', 'POWER_FAILURE', 'TEMPERATURE_RISE', 'GENERATOR_FAILURE', 'COMPRESSOR_TRIP', 'LEAKAGE', 'FIRE', 'VIBRATION', 'DOOR_ALARM', 'OTHER'];

// ---------------- Machines ----------------

async function createMachine(req, res) {
    const { name, machineType, model, warehouseBusinessId, installedDate } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const machine = await withTransaction(async (client) => {
        let warehouseId = null;
        if (warehouseBusinessId) {
            const { rows } = await client.query(`SELECT id FROM warehouses WHERE business_id = $1 AND company_id = $2`, [warehouseBusinessId, req.user.company_id]);
            if (rows.length === 0) throw Object.assign(new Error('Warehouse not found'), { statusCode: 404 });
            warehouseId = rows[0].id;
        }
        const businessId = await generateNextId('MACHINE');
        const { rows } = await client.query(
            `INSERT INTO machines (business_id, company_id, warehouse_id, name, machine_type, model, installed_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [businessId, req.user.company_id, warehouseId, name, machineType || null, model || null, installedDate || null]
        );
        return rows[0];
    });

    await generateForEntity('MACHINE', machine.business_id);
    await logAction({ actorUserId: req.user.id, action: 'MACHINE_CREATED', entityType: 'MACHINE', entityId: machine.business_id, after: machine });
    res.status(201).json({ machine });
}

async function listMachines(req, res) {
    const { rows } = await query(
        `SELECT m.*, w.business_id AS warehouse_business_id, w.name AS warehouse_name
         FROM machines m LEFT JOIN warehouses w ON w.id = m.warehouse_id
         WHERE m.company_id = $1 AND m.deleted_at IS NULL ORDER BY m.name`,
        [req.user.company_id]
    );
    res.json({ machines: rows });
}

// ---------------- Shift logs (inspection checklist + running hours + handover) ----------------

async function logShift(req, res) {
    const { machineBusinessId, shiftType, statusAtLog, runningHoursThisShift, handoverNotes, shiftDate } = req.body;
    if (!machineBusinessId || !shiftType || !statusAtLog) {
        return res.status(400).json({ error: 'machineBusinessId, shiftType, and statusAtLog are required' });
    }

    const log = await withTransaction(async (client) => {
        const { rows: machineRows } = await client.query(
            `SELECT id FROM machines WHERE business_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
            [machineBusinessId, req.user.company_id]
        );
        if (machineRows.length === 0) throw Object.assign(new Error('Machine not found'), { statusCode: 404 });
        const machineId = machineRows[0].id;

        const { rows } = await client.query(
            `INSERT INTO machine_shift_logs (machine_id, shift_date, shift_type, status_at_log, running_hours_this_shift, handover_notes, logged_by)
             VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6, $7) RETURNING *`,
            [machineId, shiftDate, shiftType, statusAtLog, runningHoursThisShift || 0, handoverNotes || null, req.user.id]
        );

        await client.query(
            `UPDATE machines SET total_running_hours = total_running_hours + $1, status = $2 WHERE id = $3`,
            [runningHoursThisShift || 0, statusAtLog === 'running' ? 'running' : (statusAtLog === 'stopped' ? 'stopped' : 'running'), machineId]
        );

        return rows[0];
    });

    res.status(201).json({ shiftLog: log });
}

async function listShiftLogs(req, res) {
    const { machineBusinessId } = req.query;
    const { rows } = await query(
        `SELECT sl.*, m.business_id AS machine_business_id, m.name AS machine_name, u.username AS logged_by_username
         FROM machine_shift_logs sl
         JOIN machines m ON m.id = sl.machine_id
         JOIN users u ON u.id = sl.logged_by
         WHERE m.company_id = $1 AND ($2::text IS NULL OR m.business_id = $2)
         ORDER BY sl.created_at DESC LIMIT 100`,
        [req.user.company_id, machineBusinessId || null]
    );
    res.json({ shiftLogs: rows });
}

// ---------------- Incidents (breakdown tickets + emergency alerts, unified) ----------------

async function createIncident(req, res) {
    const { machineBusinessId, incidentType, severity, description } = req.body;
    if (!incidentType || !description) return res.status(400).json({ error: 'incidentType and description are required' });
    if (!INCIDENT_TYPES.includes(incidentType)) return res.status(400).json({ error: `incidentType must be one of: ${INCIDENT_TYPES.join(', ')}` });

    const incident = await withTransaction(async (client) => {
        let machineId = null;
        if (machineBusinessId) {
            const { rows } = await client.query(`SELECT id FROM machines WHERE business_id = $1 AND company_id = $2`, [machineBusinessId, req.user.company_id]);
            if (rows.length === 0) throw Object.assign(new Error('Machine not found'), { statusCode: 404 });
            machineId = rows[0].id;
            if (incidentType === 'BREAKDOWN') {
                await client.query(`UPDATE machines SET status = 'breakdown' WHERE id = $1`, [machineId]);
            }
        }

        const businessId = await generateNextId('INCIDENT');
        const { rows } = await client.query(
            `INSERT INTO machine_incidents (business_id, company_id, machine_id, incident_type, severity, description, reported_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [businessId, req.user.company_id, machineId, incidentType, severity || 'medium', description, req.user.id]
        );
        return rows[0];
    });

    await logAction({ actorUserId: req.user.id, action: 'INCIDENT_REPORTED', entityType: 'INCIDENT', entityId: incident.business_id, after: incident });
    await generateForEntitySafe('MACHINE_INCIDENT', incident.business_id);
    res.status(201).json({ incident });
}

async function listIncidents(req, res) {
    const { status } = req.query;
    const { rows } = await query(
        `SELECT mi.*, m.business_id AS machine_business_id, m.name AS machine_name
         FROM machine_incidents mi LEFT JOIN machines m ON m.id = mi.machine_id
         WHERE mi.company_id = $1 AND ($2::text IS NULL OR mi.status = $2)
         ORDER BY mi.reported_at DESC`,
        [req.user.company_id, status || null]
    );
    res.json({ incidents: rows });
}

async function resolveIncident(req, res) {
    const { resolutionNotes } = req.body;
    const result = await withTransaction(async (client) => {
        const { rows } = await client.query(
            `UPDATE machine_incidents SET status = 'resolved', resolved_by = $1, resolved_at = now(), resolution_notes = $2
             WHERE business_id = $3 AND company_id = $4 AND status != 'resolved'
             RETURNING *`,
            [req.user.id, resolutionNotes || null, req.params.businessId, req.user.company_id]
        );
        if (rows.length === 0) throw Object.assign(new Error('Incident not found or already resolved'), { statusCode: 409 });

        if (rows[0].machine_id) {
            await client.query(`UPDATE machines SET status = 'running' WHERE id = $1 AND status = 'breakdown'`, [rows[0].machine_id]);
        }
        return rows[0];
    });

    await logAction({ actorUserId: req.user.id, action: 'INCIDENT_RESOLVED', entityType: 'INCIDENT', entityId: result.business_id, after: { resolutionNotes } });
    res.json({ message: 'Incident resolved', incident: result });
}

// ---------------- Preventive maintenance ----------------

async function scheduleMaintenance(req, res) {
    const { machineBusinessId, maintenanceType, scheduledDate, notes } = req.body;
    if (!machineBusinessId || !scheduledDate) return res.status(400).json({ error: 'machineBusinessId and scheduledDate are required' });

    const { rows: machineRows } = await query(`SELECT id FROM machines WHERE business_id = $1 AND company_id = $2`, [machineBusinessId, req.user.company_id]);
    if (machineRows.length === 0) return res.status(404).json({ error: 'Machine not found' });

    const { rows } = await query(
        `INSERT INTO machine_maintenance_schedule (machine_id, maintenance_type, scheduled_date, notes, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [machineRows[0].id, maintenanceType || 'preventive', scheduledDate, notes || null, req.user.id]
    );
    res.status(201).json({ maintenance: rows[0] });
}

async function listMaintenance(req, res) {
    const { rows } = await query(
        `SELECT ms.*, m.business_id AS machine_business_id, m.name AS machine_name
         FROM machine_maintenance_schedule ms JOIN machines m ON m.id = ms.machine_id
         WHERE m.company_id = $1
         ORDER BY ms.scheduled_date`,
        [req.user.company_id]
    );
    res.json({ maintenance: rows });
}

async function completeMaintenance(req, res) {
    const { notes } = req.body;
    const { rows } = await query(
        `UPDATE machine_maintenance_schedule SET status = 'completed', completed_date = CURRENT_DATE, performed_by = $1, notes = COALESCE($2, notes)
         WHERE id = $3 RETURNING *`,
        [req.user.id, notes || null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Maintenance record not found' });
    res.json({ maintenance: rows[0] });
}

async function listShifts(req,res){
    const [shifts,staff]=await Promise.all([query(`SELECT s.*,EXISTS(SELECT 1 FROM machine_shift_reports r WHERE r.shift_id=s.id AND r.report_date=CURRENT_DATE) report_submitted_today FROM manufacturing_shifts s WHERE s.company_id=$1 ORDER BY s.sort_order,s.start_time`,[req.user.company_id]),query(`SELECT id,username,COALESCE(display_name,username) name FROM users WHERE company_id=$1 AND account_type='staff' AND status='active' AND deleted_at IS NULL ORDER BY name`,[req.user.company_id])]);
    res.json({shifts:shifts.rows,staff:staff.rows});
}

async function configureShifts(req,res){
    const shifts=Array.isArray(req.body.shifts)?req.body.shifts:[];
    if(shifts.length<1||shifts.length>6)return res.status(400).json({error:'Configure between 1 and 6 daily shifts'});
    await withTransaction(async client=>{await client.query(`UPDATE manufacturing_shifts SET is_active=false WHERE company_id=$1`,[req.user.company_id]);for(let i=0;i<shifts.length;i++){const s=shifts[i];if(!s.name||!/^\d{2}:\d{2}$/.test(s.startTime||'')||!/^\d{2}:\d{2}$/.test(s.endTime||''))throw Object.assign(new Error('Every shift requires name, start time and end time'),{statusCode:400});await client.query(`INSERT INTO manufacturing_shifts(company_id,name,start_time,end_time,sort_order,is_active,created_by) VALUES($1,$2,$3,$4,$5,true,$6) ON CONFLICT(company_id,name) DO UPDATE SET start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time,sort_order=EXCLUDED.sort_order,is_active=true`,[req.user.company_id,s.name,s.startTime,s.endTime,i+1,req.user.id]);}});
    res.json({message:'Manufacturing shifts configured'});
}

function runningMinutes(start,end,stillRunning){if(!start)return 0;const [sh,sm]=start.split(':').map(Number);let finish=end;if(stillRunning){const now=new Date();finish=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;}if(!finish)return 0;const [eh,em]=finish.split(':').map(Number);let minutes=(eh*60+em)-(sh*60+sm);if(minutes<0)minutes+=1440;return minutes;}

async function submitShiftReport(req,res){
    const {shiftId,reportDate,overallSummary,handoverNotes,handoverToUserId}=req.body,entries=Array.isArray(req.body.entries)?req.body.entries.filter(x=>x.selected):[];
    if(!shiftId||!reportDate)return res.status(400).json({error:'Shift and report date are required'});
    if(!entries.length)return res.status(400).json({error:'Select at least one machine or equipment for the shift report'});
    const businessId=await generateNextId('MACHINE_SHIFT_REPORT');
    const report=await withTransaction(async client=>{const shift=(await client.query(`SELECT id FROM manufacturing_shifts WHERE id=$1 AND company_id=$2 AND is_active=true`,[shiftId,req.user.company_id])).rows[0];if(!shift)throw Object.assign(new Error('Active shift not found'),{statusCode:404});if(handoverToUserId){const staff=(await client.query(`SELECT id FROM users WHERE id=$1 AND company_id=$2 AND status='active' AND deleted_at IS NULL`,[handoverToUserId,req.user.company_id])).rows[0];if(!staff)throw Object.assign(new Error('Handover staff not found'),{statusCode:404});}const {rows}=await client.query(`INSERT INTO machine_shift_reports(business_id,company_id,shift_id,report_date,reporter_id,overall_summary,handover_notes,handover_to_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(company_id,shift_id,report_date,reporter_id) DO UPDATE SET overall_summary=EXCLUDED.overall_summary,handover_notes=EXCLUDED.handover_notes,handover_to_user_id=EXCLUDED.handover_to_user_id,submitted_at=now() RETURNING *`,[businessId,req.user.company_id,shift.id,reportDate,req.user.id,overallSummary||null,handoverNotes||null,handoverToUserId||null]);await client.query(`DELETE FROM machine_shift_report_entries WHERE report_id=$1`,[rows[0].id]);for(const e of entries){const machine=(await client.query(`SELECT id FROM machines WHERE business_id=$1 AND company_id=$2 AND deleted_at IS NULL`,[e.machineBusinessId,req.user.company_id])).rows[0];if(!machine)throw Object.assign(new Error(`Machine not found: ${e.machineBusinessId}`),{statusCode:404});const minutes=runningMinutes(e.runStart,e.runEnd,e.stillRunning);await client.query(`INSERT INTO machine_shift_report_entries(report_id,machine_id,operated,run_start,run_end,still_running,running_minutes,condition_status,notes,remarks,follow_up_instruction) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[rows[0].id,machine.id,e.operated!==false,e.runStart||null,e.stillRunning?null:(e.runEnd||null),Boolean(e.stillRunning),minutes,e.conditionStatus||'all_good',e.notes||null,e.remarks||null,e.followUpInstruction||null]);await client.query(`UPDATE machines SET total_running_hours=total_running_hours+$1,status=$2 WHERE id=$3`,[minutes/60,e.stillRunning?'running':(e.operated===false?'stopped':'running'),machine.id]);}return rows[0];});
    await logAction({actorUserId:req.user.id,action:'MACHINE_SHIFT_REPORT_SUBMITTED',entityType:'MACHINE_SHIFT_REPORT',entityId:report.business_id,after:{entryCount:entries.length}});res.status(201).json({report});
}

async function listShiftReports(req,res){const {rows}=await query(`SELECT r.*,s.name shift_name,s.start_time shift_start,s.end_time shift_end,COALESCE(u.display_name,u.username) reporter_name,COALESCE(h.display_name,h.username) handover_to_name,COALESCE(json_agg(json_build_object('machineBusinessId',m.business_id,'machineName',m.name,'operated',e.operated,'runStart',e.run_start,'runEnd',e.run_end,'stillRunning',e.still_running,'runningMinutes',e.running_minutes,'conditionStatus',e.condition_status,'notes',e.notes,'remarks',e.remarks,'followUpInstruction',e.follow_up_instruction) ORDER BY m.name) FILTER(WHERE e.id IS NOT NULL),'[]') entries FROM machine_shift_reports r JOIN manufacturing_shifts s ON s.id=r.shift_id JOIN users u ON u.id=r.reporter_id LEFT JOIN users h ON h.id=r.handover_to_user_id LEFT JOIN machine_shift_report_entries e ON e.report_id=r.id LEFT JOIN machines m ON m.id=e.machine_id WHERE r.company_id=$1 GROUP BY r.id,s.id,u.id,h.id ORDER BY r.report_date DESC,s.sort_order,r.submitted_at DESC LIMIT 500`,[req.user.company_id]);res.json({reports:rows});}

async function machineHistory(req,res){const cutoff=req.query.from||new Date(Date.now()-730*86400000).toISOString().slice(0,10),machine=(await query(`SELECT m.*,w.name warehouse_name FROM machines m LEFT JOIN warehouses w ON w.id=m.warehouse_id WHERE m.business_id=$1 AND m.company_id=$2 AND m.deleted_at IS NULL`,[req.params.businessId,req.user.company_id])).rows[0];if(!machine)return res.status(404).json({error:'Machine not found'});const [entries,legacy,incidents,maintenance]=await Promise.all([query(`SELECT r.business_id report_id,r.report_date,s.name shift_name,s.start_time shift_start,s.end_time shift_end,e.*,COALESCE(u.display_name,u.username) reporter_name,COALESCE(h.display_name,h.username) handover_to_name,r.overall_summary,r.handover_notes FROM machine_shift_report_entries e JOIN machine_shift_reports r ON r.id=e.report_id JOIN manufacturing_shifts s ON s.id=r.shift_id JOIN users u ON u.id=r.reporter_id LEFT JOIN users h ON h.id=r.handover_to_user_id WHERE e.machine_id=$1 AND r.report_date>=$2 ORDER BY r.report_date DESC,r.submitted_at DESC`,[machine.id,cutoff]),query(`SELECT sl.*,u.username logged_by_username FROM machine_shift_logs sl JOIN users u ON u.id=sl.logged_by WHERE sl.machine_id=$1 AND sl.shift_date>=$2 ORDER BY sl.shift_date DESC`,[machine.id,cutoff]),query(`SELECT mi.*,u.username reported_by_name,ru.username resolved_by_name FROM machine_incidents mi JOIN users u ON u.id=mi.reported_by LEFT JOIN users ru ON ru.id=mi.resolved_by WHERE mi.machine_id=$1 AND mi.reported_at::date>=$2 ORDER BY mi.reported_at DESC`,[machine.id,cutoff]),query(`SELECT ms.*,u.username performed_by_name FROM machine_maintenance_schedule ms LEFT JOIN users u ON u.id=ms.performed_by WHERE ms.machine_id=$1 AND ms.scheduled_date>=$2 ORDER BY ms.scheduled_date DESC`,[machine.id,cutoff])]);res.json({machine,from:cutoff,shiftOperations:entries.rows,legacyShiftLogs:legacy.rows,incidents:incidents.rows,maintenance:maintenance.rows});}

module.exports = {
    createMachine, listMachines, logShift, listShiftLogs,
    createIncident, listIncidents, resolveIncident,
    scheduleMaintenance, listMaintenance, completeMaintenance,
    listShifts,configureShifts,submitShiftReport,listShiftReports,machineHistory
};
