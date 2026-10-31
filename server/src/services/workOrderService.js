import { transaction } from '../db/index.js';
import { conflict, notFound, ruleViolation } from '../errors.js';
import {
  allowedTransitions,
  assertAssetAcceptsWorkOrder,
  assertCriticalHasTechnician,
  assertScheduleNotInPast,
  assertTransition,
  isTerminal,
  toLocalDateString,
} from '../domain/workOrderRules.js';

const SELECT_WORK_ORDER = `
  SELECT wo.*,
         a.asset_code, a.asset_type, a.manufacturer, a.model, a.status AS asset_status,
         t.name AS technician_name, t.skill AS technician_skill,
         mt.code AS mt_code, mt.name AS mt_name, mt.is_emergency AS mt_is_emergency
  FROM work_orders wo
  JOIN assets a             ON a.id = wo.asset_id
  JOIN maintenance_types mt ON mt.id = wo.maintenance_type_id
  LEFT JOIN technicians t   ON t.id = wo.technician_id`;

function toDto(row) {
  return {
    id: row.id,
    work_order_number: row.work_order_number,
    description: row.description,
    priority: row.priority,
    status: row.status,
    scheduled_date: row.scheduled_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    cancelled_at: row.cancelled_at,
    asset: {
      id: row.asset_id,
      asset_code: row.asset_code,
      asset_type: row.asset_type,
      manufacturer: row.manufacturer,
      model: row.model,
      status: row.asset_status,
    },
    maintenance_type: {
      id: row.maintenance_type_id,
      code: row.mt_code,
      name: row.mt_name,
      is_emergency: Boolean(row.mt_is_emergency),
    },
    technician: row.technician_id
      ? { id: row.technician_id, name: row.technician_name, skill: row.technician_skill }
      : null,
    allowed_transitions: allowedTransitions(row.status),
  };
}

export function createWorkOrderService({ db, clock }) {
  const today = () => toLocalDateString(clock());
  const nowIso = () => clock().toISOString();

  const getRow = (id) => db.prepare(`${SELECT_WORK_ORDER} WHERE wo.id = ?`).get(id);

  function get(id) {
    const row = getRow(id);
    if (!row) throw notFound('Work order', id);
    return toDto(row);
  }

  function list({ status, priority, asset_id, technician_id, maintenance_type_id, q, limit, offset }) {
    const where = [];
    const params = [];
    const filters = {
      'wo.status': status,
      'wo.priority': priority,
      'wo.asset_id': asset_id,
      'wo.technician_id': technician_id,
      'wo.maintenance_type_id': maintenance_type_id,
    };
    for (const [column, value] of Object.entries(filters)) {
      if (value !== undefined) {
        where.push(`${column} = ?`);
        params.push(value);
      }
    }
    if (q) {
      where.push('(wo.work_order_number LIKE ? OR wo.description LIKE ? OR a.asset_code LIKE ? OR t.name LIKE ?)');
      params.push(...Array(4).fill(`%${q}%`));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { total } = db
      .prepare(
        `SELECT COUNT(*) AS total FROM work_orders wo
         JOIN assets a ON a.id = wo.asset_id
         LEFT JOIN technicians t ON t.id = wo.technician_id ${whereSql}`,
      )
      .get(...params);
    const rows = db
      .prepare(`${SELECT_WORK_ORDER} ${whereSql} ORDER BY wo.created_at DESC, wo.id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    return { data: rows.map(toDto), total, limit, offset };
  }

  function history(id) {
    get(id);
    return db
      .prepare(
        `SELECT h.id, h.from_status, h.to_status, h.note, h.changed_at,
                h.technician_id, t.name AS technician_name
         FROM work_order_status_history h
         LEFT JOIN technicians t ON t.id = h.technician_id
         WHERE h.work_order_id = ?
         ORDER BY h.changed_at, h.id`,
      )
      .all(id);
  }

  // Referenced records that don't exist are a business-level problem with the request (422), not a missing route (404).
  function requireAsset(assetId) {
    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
    if (!asset) throw ruleViolation('ASSET_NOT_FOUND', `Asset ${assetId} does not exist`);
    return asset;
  }

  function requireMaintenanceType(typeId) {
    const type = db.prepare('SELECT * FROM maintenance_types WHERE id = ?').get(typeId);
    if (!type) throw ruleViolation('MAINTENANCE_TYPE_NOT_FOUND', `Maintenance type ${typeId} does not exist`);
    return type;
  }

  function requireAssignableTechnician(technicianId) {
    const technician = db.prepare('SELECT * FROM technicians WHERE id = ?').get(technicianId);
    if (!technician) throw ruleViolation('TECHNICIAN_NOT_FOUND', `Technician ${technicianId} does not exist`);
    if (technician.status !== 'ACTIVE') {
      throw ruleViolation('TECHNICIAN_UNAVAILABLE', `Technician ${technician.name} is ${technician.status}`);
    }
    return technician;
  }

  function assertNumberAvailable(number, excludeId = 0) {
    if (db.prepare('SELECT 1 FROM work_orders WHERE work_order_number = ? AND id <> ?').get(number, excludeId)) {
      throw conflict('DUPLICATE_WORK_ORDER_NUMBER', `Work order number ${number} already exists`);
    }
  }

  function nextWorkOrderNumber() {
    const { maxId } = db.prepare('SELECT COALESCE(MAX(id), 0) AS maxId FROM work_orders').get();
    let n = 1001 + maxId;
    while (db.prepare('SELECT 1 FROM work_orders WHERE work_order_number = ?').get(`WO-${n}`)) n++;
    return `WO-${n}`;
  }

  function recordHistory(workOrderId, fromStatus, toStatus, technicianId, note, changedAt) {
    db.prepare(
      `INSERT INTO work_order_status_history (work_order_id, from_status, to_status, technician_id, note, changed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(workOrderId, fromStatus, toStatus, technicianId ?? null, note ?? null, changedAt);
  }

  function create(input) {
    return transaction(db, () => {
      const asset = requireAsset(input.asset_id);
      const type = requireMaintenanceType(input.maintenance_type_id);
      const technician = input.technician_id ? requireAssignableTechnician(input.technician_id) : null;

      assertScheduleNotInPast(input.scheduled_date, today());
      assertCriticalHasTechnician(input.priority, technician?.id);
      assertAssetAcceptsWorkOrder(asset, type);

      const number = input.work_order_number ?? nextWorkOrderNumber();
      assertNumberAvailable(number);

      // Supplying a technician up front is an assignment, so the order starts as ASSIGNED.
      const status = technician ? 'ASSIGNED' : 'OPEN';
      const now = nowIso();
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO work_orders (work_order_number, asset_id, maintenance_type_id, technician_id, description,
                                    priority, status, scheduled_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          number,
          asset.id,
          type.id,
          technician?.id ?? null,
          input.description,
          input.priority,
          status,
          input.scheduled_date,
          now,
          now,
        );
      const id = Number(lastInsertRowid);
      recordHistory(id, null, status, technician?.id, 'Work order created', now);
      return get(id);
    });
  }

  function update(id, input) {
    return transaction(db, () => {
      const current = getRow(id);
      if (!current) throw notFound('Work order', id);

      if (isTerminal(current.status)) {
        if (input.status !== undefined) assertTransition(current.status, input.status);
        throw ruleViolation('WORK_ORDER_CLOSED', `Work order is ${current.status} and can no longer be modified`);
      }

      const next = {
        work_order_number: input.work_order_number ?? current.work_order_number,
        maintenance_type_id: input.maintenance_type_id ?? current.maintenance_type_id,
        description: input.description ?? current.description,
        priority: input.priority ?? current.priority,
        scheduled_date: input.scheduled_date ?? current.scheduled_date,
        technician_id: input.technician_id !== undefined ? input.technician_id : current.technician_id,
        status: input.status ?? current.status,
      };

      const technicianChanged = next.technician_id !== current.technician_id;
      if (technicianChanged) {
        if (next.technician_id === null) {
          if (current.status !== 'OPEN') {
            throw ruleViolation(
              'TECHNICIAN_REQUIRED',
              `A ${current.status} work order must keep an assigned technician`,
            );
          }
        } else {
          requireAssignableTechnician(next.technician_id);
        }
      }
      // Giving an OPEN order a technician is what "assigning" means.
      if (next.status === 'OPEN' && next.technician_id !== null) next.status = 'ASSIGNED';

      if (next.status !== current.status) {
        assertTransition(current.status, next.status);
        if (next.status === 'ASSIGNED' && next.technician_id === null) {
          throw ruleViolation('TECHNICIAN_REQUIRED', 'Assign a technician to move a work order to ASSIGNED');
        }
      }

      assertCriticalHasTechnician(next.priority, next.technician_id);

      if (next.scheduled_date !== current.scheduled_date) {
        assertScheduleNotInPast(next.scheduled_date, today());
      }

      // Re-check Rule 6 so it can't be bypassed by creating as EMERGENCY and then switching type.
      if (next.maintenance_type_id !== current.maintenance_type_id) {
        assertAssetAcceptsWorkOrder(requireAsset(current.asset_id), requireMaintenanceType(next.maintenance_type_id));
      }

      if (next.work_order_number !== current.work_order_number) assertNumberAvailable(next.work_order_number, id);

      const now = nowIso();
      const stampIf = (status, existing) => (next.status === status && current.status !== status ? now : existing);
      db.prepare(
        `UPDATE work_orders
         SET work_order_number = ?, maintenance_type_id = ?, technician_id = ?, description = ?, priority = ?,
             status = ?, scheduled_date = ?, updated_at = ?, started_at = ?, completed_at = ?, cancelled_at = ?
         WHERE id = ?`,
      ).run(
        next.work_order_number,
        next.maintenance_type_id,
        next.technician_id,
        next.description,
        next.priority,
        next.status,
        next.scheduled_date,
        now,
        stampIf('IN_PROGRESS', current.started_at),
        stampIf('COMPLETED', current.completed_at),
        stampIf('CANCELLED', current.cancelled_at),
        id,
      );

      if (next.status !== current.status) {
        recordHistory(id, current.status, next.status, next.technician_id, input.note, now);
      } else if (technicianChanged) {
        recordHistory(id, current.status, next.status, next.technician_id, input.note ?? 'Technician reassigned', now);
      }
      return get(id);
    });
  }

  return { get, list, history, create, update };
}
