import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

describe('assets API', () => {
  it('creates, reads, lists and updates an asset', async () => {
    const { api, createAsset } = setup();
    const asset = await createAsset({ asset_code: 'ast-2000' });
    assert.equal(asset.asset_code, 'AST-2000');
    assert.equal(asset.status, 'ACTIVE');

    assert.equal((await api.get(`/api/assets/${asset.id}`)).body.serial_number, asset.serial_number);
    assert.equal((await api.get('/api/assets')).body.length, 1);

    const updated = await api.put(`/api/assets/${asset.id}`).send({ usage_hours: 150, status: 'OUT_OF_SERVICE' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.usage_hours, 150);
    assert.equal(updated.body.status, 'OUT_OF_SERVICE');
  });

  it('rejects duplicate asset codes (case-insensitive) with 409', async () => {
    const { api, createAsset } = setup();
    await createAsset({ asset_code: 'AST-1' });
    const res = await api.post('/api/assets').send({
      asset_code: 'ast-1', asset_type: 'Pump', manufacturer: 'X', model: 'Y', serial_number: 'Z',
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'DUPLICATE_ASSET_CODE');
  });

  it('rejects decreasing usage counters', async () => {
    const { api, createAsset } = setup();
    const asset = await createAsset({ usage_hours: 500 });
    const res = await api.put(`/api/assets/${asset.id}`).send({ usage_hours: 400 });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'USAGE_CANNOT_DECREASE');
  });

  it('validates input and unknown ids', async () => {
    const { api } = setup();
    const bad = await api.post('/api/assets').send({ asset_code: '', usage_hours: -1, status: 'BROKEN' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'VALIDATION_ERROR');
    assert.ok(bad.body.error.details.some((d) => d.field === 'usage_hours'));

    assert.equal((await api.get('/api/assets/999')).status, 404);
    assert.equal((await api.get('/api/assets/abc')).status, 400);
  });
});

describe('technicians API', () => {
  it('creates, reads and lists technicians', async () => {
    const { api, createTechnician } = setup();
    const tech = await createTechnician({ name: 'Anjali', skill: 'Avionics' });
    assert.equal(tech.status, 'ACTIVE');
    assert.equal(tech.open_work_orders, 0);
    assert.equal((await api.get(`/api/technicians/${tech.id}`)).body.name, 'Anjali');
    assert.equal((await api.get('/api/technicians?status=active')).body.length, 1);
    assert.equal((await api.get('/api/technicians/42')).status, 404);
  });
});
