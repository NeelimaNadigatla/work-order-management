import { notFound } from '../errors.js';

export function createTechnicianService({ db, clock }) {
  function get(id) {
    const technician = db.prepare('SELECT * FROM technicians WHERE id = ?').get(id);
    if (!technician) throw notFound('Technician', id);
    const { open_work_orders } = db
      .prepare(
        `SELECT COUNT(*) AS open_work_orders FROM work_orders
         WHERE technician_id = ? AND status IN ('ASSIGNED', 'IN_PROGRESS')`,
      )
      .get(id);
    return { ...technician, open_work_orders };
  }

  function list({ status, q }) {
    const where = [];
    const params = [];
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    if (q) {
      where.push('(name LIKE ? OR skill LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    const sql = `SELECT * FROM technicians ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name`;
    return db.prepare(sql).all(...params);
  }

  function create({ name, skill, status }) {
    const now = clock().toISOString();
    const { lastInsertRowid } = db
      .prepare('INSERT INTO technicians (name, skill, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(name, skill, status, now, now);
    return get(Number(lastInsertRowid));
  }

  function update(id, input) {
    const next = { ...get(id), ...input };
    db.prepare('UPDATE technicians SET name = ?, skill = ?, status = ?, updated_at = ? WHERE id = ?').run(
      next.name,
      next.skill,
      next.status,
      clock().toISOString(),
      id,
    );
    return get(id);
  }

  return { get, list, create, update };
}
