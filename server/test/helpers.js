import request from 'supertest';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db/index.js';

// Fixed "now" so date rules are deterministic: 15 June 2026, local time.
export const TODAY = '2026-06-15';
export const YESTERDAY = '2026-06-14';
export const TOMORROW = '2026-06-16';

export function setup() {
  const db = openDatabase(':memory:');
  const app = createApp({ db, clock: () => new Date(2026, 5, 15, 10, 0, 0) });
  // A fresh supertest agent per call: a shared one closes its server after the first request.
  const api = {
    get: (url) => request(app).get(url),
    post: (url) => request(app).post(url),
    put: (url) => request(app).put(url),
  };
  const types = Object.fromEntries(db.prepare('SELECT code, id FROM maintenance_types').all().map((t) => [t.code, t.id]));

  let assetSeq = 0;
  const createAsset = async (overrides = {}) => {
    assetSeq++;
    const res = await api.post('/api/assets').send({
      asset_code: `AST-${1000 + assetSeq}`,
      asset_type: 'Pump',
      manufacturer: 'Parker',
      model: 'PV180',
      serial_number: `SN-${assetSeq}`,
      usage_hours: 100,
      usage_cycles: 10,
      ...overrides,
    });
    if (res.status !== 201) throw new Error(`createAsset failed: ${JSON.stringify(res.body)}`);
    return res.body;
  };

  const createTechnician = async (overrides = {}) => {
    const res = await api.post('/api/technicians').send({ name: 'Ravi Kumar', skill: 'Hydraulics', ...overrides });
    if (res.status !== 201) throw new Error(`createTechnician failed: ${JSON.stringify(res.body)}`);
    return res.body;
  };

  const workOrderBody = (asset, overrides = {}) => ({
    asset_id: asset.id,
    maintenance_type_id: types.INSPECTION,
    description: 'Routine inspection',
    priority: 'MEDIUM',
    scheduled_date: TOMORROW,
    ...overrides,
  });

  return { db, api, types, createAsset, createTechnician, workOrderBody };
}
