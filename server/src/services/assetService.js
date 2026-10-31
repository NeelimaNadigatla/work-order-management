import { conflict, notFound, ruleViolation } from '../errors.js';

export function createAssetService({ db, clock }) {
  function get(id) {
    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
    if (!asset) throw notFound('Asset', id);
    return asset;
  }

  function list({ status, q }) {
    const where = [];
    const params = [];
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    if (q) {
      where.push('(asset_code LIKE ? OR asset_type LIKE ? OR manufacturer LIKE ? OR model LIKE ? OR serial_number LIKE ?)');
      params.push(...Array(5).fill(`%${q}%`));
    }
    const sql = `SELECT * FROM assets ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY asset_code`;
    return db.prepare(sql).all(...params);
  }

  function assertUnique({ asset_code, manufacturer, serial_number }, excludeId = 0) {
    if (db.prepare('SELECT 1 FROM assets WHERE asset_code = ? AND id <> ?').get(asset_code, excludeId)) {
      throw conflict('DUPLICATE_ASSET_CODE', `Asset ID ${asset_code} already exists`);
    }
    const sameSerial = db
      .prepare('SELECT 1 FROM assets WHERE manufacturer = ? AND serial_number = ? AND id <> ?')
      .get(manufacturer, serial_number, excludeId);
    if (sameSerial) {
      throw conflict('DUPLICATE_SERIAL_NUMBER', `${manufacturer} serial number ${serial_number} is already registered`);
    }
  }

  function create(input) {
    assertUnique(input);
    const now = clock().toISOString();
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO assets (asset_code, asset_type, manufacturer, model, serial_number,
                             usage_hours, usage_cycles, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.asset_code,
        input.asset_type,
        input.manufacturer,
        input.model,
        input.serial_number,
        input.usage_hours,
        input.usage_cycles,
        input.status,
        now,
        now,
      );
    return get(Number(lastInsertRowid));
  }

  function update(id, input) {
    const current = get(id);
    const next = { ...current, ...input };
    // Usage counters are meter readings: they only ever go up.
    if (next.usage_hours < current.usage_hours || next.usage_cycles < current.usage_cycles) {
      throw ruleViolation('USAGE_CANNOT_DECREASE', 'Usage hours and usage cycles cannot be decreased');
    }
    assertUnique(next, id);
    db.prepare(
      `UPDATE assets SET asset_code = ?, asset_type = ?, manufacturer = ?, model = ?, serial_number = ?,
              usage_hours = ?, usage_cycles = ?, status = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      next.asset_code,
      next.asset_type,
      next.manufacturer,
      next.model,
      next.serial_number,
      next.usage_hours,
      next.usage_cycles,
      next.status,
      clock().toISOString(),
      id,
    );
    return get(id);
  }

  return { get, list, create, update };
}
