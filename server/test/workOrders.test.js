import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setup, TODAY, YESTERDAY } from './helpers.js';

const expectRule = (res, status, code) => {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.error.code, code);
};

describe('work orders: creation', () => {
  it('creates an OPEN work order with a generated number and created date', async () => {
    const { api, createAsset, workOrderBody } = setup();
    const asset = await createAsset();
    const res = await api.post('/api/work-orders').send(workOrderBody(asset));
    assert.equal(res.status, 201);
    assert.equal(res.body.work_order_number, 'WO-1001');
    assert.equal(res.body.status, 'OPEN');
    assert.equal(res.body.technician, null);
    assert.ok(res.body.created_at);
    assert.equal(res.body.completed_at, null);
    assert.deepEqual(res.body.allowed_transitions, ['ASSIGNED', 'CANCELLED']);
  });

  it('starts as ASSIGNED when a technician is given', async () => {
    const { api, createAsset, createTechnician, workOrderBody } = setup();
    const [asset, tech] = [await createAsset(), await createTechnician()];
    const res = await api.post('/api/work-orders').send(workOrderBody(asset, { technician_id: tech.id }));
    assert.equal(res.body.status, 'ASSIGNED');
    assert.equal(res.body.technician.id, tech.id);
  });

  it('rejects unavailable technicians and unknown references', async () => {
    const { api, createAsset, createTechnician, workOrderBody } = setup();
    const asset = await createAsset();
    const onLeave = await createTechnician({ status: 'ON_LEAVE' });
    expectRule(
      await api.post('/api/work-orders').send(workOrderBody(asset, { technician_id: onLeave.id })),
      422,
      'TECHNICIAN_UNAVAILABLE',
    );
    expectRule(await api.post('/api/work-orders').send(workOrderBody({ id: 999 })), 422, 'ASSET_NOT_FOUND');
  });

  it('validates the request body', async () => {
    const { api } = setup();
    const res = await api.post('/api/work-orders').send({ priority: 'URGENT', scheduled_date: '2026-02-30' });
    expectRule(res, 400, 'VALIDATION_ERROR');
    const fields = res.body.error.details.map((d) => d.field);
    for (const f of ['asset_id', 'maintenance_type_id', 'description', 'priority', 'scheduled_date']) {
      assert.ok(fields.includes(f), `expected error for ${f}`);
    }
  });
});

describe('Rule 1: unique work order number', () => {
  it('rejects a duplicate number, case-insensitively', async () => {
    const { api, createAsset, workOrderBody } = setup();
    const asset = await createAsset();
    await api.post('/api/work-orders').send(workOrderBody(asset, { work_order_number: 'WO-5000' }));
    const dup = await api.post('/api/work-orders').send(workOrderBody(asset, { work_order_number: 'wo-5000' }));
    expectRule(dup, 409, 'DUPLICATE_WORK_ORDER_NUMBER');
  });

  it('rejects renaming to an existing number', async () => {
    const { api, createAsset, workOrderBody } = setup();
    const asset = await createAsset();
    const a = (await api.post('/api/work-orders').send(workOrderBody(asset))).body;
    const b = (await api.post('/api/work-orders').send(workOrderBody(asset))).body;
    expectRule(
      await api.put(`/api/work-orders/${b.id}`).send({ work_order_number: a.work_order_number }),
      409,
      'DUPLICATE_WORK_ORDER_NUMBER',
    );
  });

  it('generated numbers skip ones already taken manually', async () => {
    const { api, createAsset, workOrderBody } = setup();
    const asset = await createAsset();
    await api.post('/api/work-orders').send(workOrderBody(asset, { work_order_number: 'WO-1002' }));
    const next = await api.post('/api/work-orders').send(workOrderBody(asset));
    assert.equal(next.body.work_order_number, 'WO-1003');
  });

  it('is also enforced by the database', async () => {
    const { db, api, createAsset, workOrderBody } = setup();
    const asset = await createAsset();
    const wo = (await api.post('/api/work-orders').send(workOrderBody(asset))).body;
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO work_orders (work_order_number, asset_id, maintenance_type_id, description, priority, scheduled_date)
           VALUES (?, ?, 1, 'x', 'LOW', '2030-01-01')`,
        )
        .run(wo.work_order_number.toLowerCase(), asset.id),
    /UNIQUE/);
  });
});

describe('Rule 2: critical work needs a technician', () => {
  it('rejects creating a CRITICAL order without a technician', async () => {
    const { api, createAsset, workOrderBody } = setup();
    const asset = await createAsset();
    expectRule(
      await api.post('/api/work-orders').send(workOrderBody(asset, { priority: 'CRITICAL' })),
      422,
      'CRITICAL_REQUIRES_TECHNICIAN',
    );
  });

  it('rejects raising priority to CRITICAL on an unassigned order', async () => {
    const { api, createAsset, workOrderBody } = setup();
    const wo = (await api.post('/api/work-orders').send(workOrderBody(await createAsset()))).body;
    expectRule(
      await api.put(`/api/work-orders/${wo.id}`).send({ priority: 'CRITICAL' }),
      422,
      'CRITICAL_REQUIRES_TECHNICIAN',
    );
  });

  it('accepts CRITICAL with a technician, and prevents removing them', async () => {
    const { api, createAsset, createTechnician, workOrderBody } = setup();
    const tech = await createTechnician();
    const res = await api
      .post('/api/work-orders')
      .send(workOrderBody(await createAsset(), { priority: 'CRITICAL', technician_id: tech.id }));
    assert.equal(res.status, 201);
    const unassign = await api.put(`/api/work-orders/${res.body.id}`).send({ technician_id: null });
    assert.equal(unassign.status, 422);
  });
});

describe('Rules 3 & 4: terminal statuses', () => {
  async function completedOrder(ctx) {
    const tech = await ctx.createTechnician();
    const wo = (await ctx.api.post('/api/work-orders').send(ctx.workOrderBody(await ctx.createAsset(), { technician_id: tech.id }))).body;
    await ctx.api.put(`/api/work-orders/${wo.id}`).send({ status: 'IN_PROGRESS' });
    return (await ctx.api.put(`/api/work-orders/${wo.id}`).send({ status: 'COMPLETED' })).body;
  }

  it('Rule 3: a COMPLETED order cannot return to OPEN', async () => {
    const ctx = setup();
    const wo = await completedOrder(ctx);
    assert.equal(wo.status, 'COMPLETED');
    assert.ok(wo.completed_at);
    expectRule(await ctx.api.put(`/api/work-orders/${wo.id}`).send({ status: 'OPEN' }), 422, 'COMPLETED_IS_FINAL');
  });

  it('Rule 3: a COMPLETED order cannot be edited at all', async () => {
    const ctx = setup();
    const wo = await completedOrder(ctx);
    expectRule(await ctx.api.put(`/api/work-orders/${wo.id}`).send({ description: 'x' }), 422, 'WORK_ORDER_CLOSED');
  });

  it('Rule 4: a CANCELLED order cannot move to IN_PROGRESS', async () => {
    const { api, createAsset, workOrderBody } = setup();
    const wo = (await api.post('/api/work-orders').send(workOrderBody(await createAsset()))).body;
    const cancelled = await api.put(`/api/work-orders/${wo.id}`).send({ status: 'CANCELLED' });
    assert.equal(cancelled.body.status, 'CANCELLED');
    assert.ok(cancelled.body.cancelled_at);
    expectRule(await api.put(`/api/work-orders/${wo.id}`).send({ status: 'IN_PROGRESS' }), 422, 'CANCELLED_IS_FINAL');
  });

  it('the database trigger blocks terminal-status changes that bypass the API', async () => {
    const ctx = setup();
    const wo = await completedOrder(ctx);
    assert.throws(
      () => ctx.db.prepare("UPDATE work_orders SET status = 'OPEN', completed_at = NULL WHERE id = ?").run(wo.id),
      /terminal status/,
    );
  });
});

describe('Rule 5: scheduled date', () => {
  it('rejects a past date on creation and accepts today', async () => {
    const { api, createAsset, workOrderBody } = setup();
    const asset = await createAsset();
    expectRule(
      await api.post('/api/work-orders').send(workOrderBody(asset, { scheduled_date: YESTERDAY })),
      422,
      'SCHEDULED_DATE_IN_PAST',
    );
    assert.equal((await api.post('/api/work-orders').send(workOrderBody(asset, { scheduled_date: TODAY }))).status, 201);
  });

  it('rejects rescheduling into the past', async () => {
    const { api, createAsset, workOrderBody } = setup();
    const wo = (await api.post('/api/work-orders').send(workOrderBody(await createAsset()))).body;
    expectRule(
      await api.put(`/api/work-orders/${wo.id}`).send({ scheduled_date: YESTERDAY }),
      422,
      'SCHEDULED_DATE_IN_PAST',
    );
  });
});

describe('Rule 6: OUT_OF_SERVICE assets', () => {
  it('rejects non-emergency work and accepts emergency work', async () => {
    const { api, types, createAsset, createTechnician, workOrderBody } = setup();
    const asset = await createAsset({ status: 'OUT_OF_SERVICE' });
    expectRule(
      await api.post('/api/work-orders').send(workOrderBody(asset, { maintenance_type_id: types.REPAIR })),
      422,
      'ASSET_OUT_OF_SERVICE',
    );
    const tech = await createTechnician();
    const ok = await api
      .post('/api/work-orders')
      .send(workOrderBody(asset, { maintenance_type_id: types.EMERGENCY_REPAIR, technician_id: tech.id }));
    assert.equal(ok.status, 201);
    assert.equal(ok.body.maintenance_type.is_emergency, true);
  });

  it('cannot be bypassed by switching an emergency order to a routine type', async () => {
    const { api, types, createAsset, workOrderBody } = setup();
    const asset = await createAsset({ status: 'OUT_OF_SERVICE' });
    const wo = (await api.post('/api/work-orders').send(workOrderBody(asset, { maintenance_type_id: types.EMERGENCY_REPAIR }))).body;
    expectRule(
      await api.put(`/api/work-orders/${wo.id}`).send({ maintenance_type_id: types.INSPECTION }),
      422,
      'ASSET_OUT_OF_SERVICE',
    );
  });

  it('rejects any new work on RETIRED assets', async () => {
    const { api, types, createAsset, workOrderBody } = setup();
    const asset = await createAsset({ status: 'RETIRED' });
    expectRule(
      await api.post('/api/work-orders').send(workOrderBody(asset, { maintenance_type_id: types.EMERGENCY_REPAIR })),
      422,
      'ASSET_RETIRED',
    );
  });
});

describe('work orders: lifecycle and history', () => {
  it('assigning a technician to an OPEN order moves it to ASSIGNED', async () => {
    const { api, createAsset, createTechnician, workOrderBody } = setup();
    const wo = (await api.post('/api/work-orders').send(workOrderBody(await createAsset()))).body;
    const tech = await createTechnician();
    const res = await api.put(`/api/work-orders/${wo.id}`).send({ technician_id: tech.id });
    assert.equal(res.body.status, 'ASSIGNED');
  });

  it('cannot move to ASSIGNED without a technician, nor skip to IN_PROGRESS', async () => {
    const { api, createAsset, workOrderBody } = setup();
    const wo = (await api.post('/api/work-orders').send(workOrderBody(await createAsset()))).body;
    expectRule(await api.put(`/api/work-orders/${wo.id}`).send({ status: 'ASSIGNED' }), 422, 'TECHNICIAN_REQUIRED');
    expectRule(await api.put(`/api/work-orders/${wo.id}`).send({ status: 'IN_PROGRESS' }), 422, 'INVALID_STATUS_TRANSITION');
  });

  it('cannot cancel once IN_PROGRESS', async () => {
    const { api, createAsset, createTechnician, workOrderBody } = setup();
    const tech = await createTechnician();
    const wo = (await api.post('/api/work-orders').send(workOrderBody(await createAsset(), { technician_id: tech.id }))).body;
    await api.put(`/api/work-orders/${wo.id}`).send({ status: 'IN_PROGRESS' });
    expectRule(await api.put(`/api/work-orders/${wo.id}`).send({ status: 'CANCELLED' }), 422, 'INVALID_STATUS_TRANSITION');
  });

  it('records the full status history', async () => {
    const { api, createAsset, createTechnician, workOrderBody } = setup();
    const tech = await createTechnician();
    const wo = (await api.post('/api/work-orders').send(workOrderBody(await createAsset()))).body;
    await api.put(`/api/work-orders/${wo.id}`).send({ technician_id: tech.id });
    await api.put(`/api/work-orders/${wo.id}`).send({ status: 'IN_PROGRESS' });
    await api.put(`/api/work-orders/${wo.id}`).send({ status: 'COMPLETED', note: 'done' });
    const history = (await api.get(`/api/work-orders/${wo.id}/history`)).body;
    assert.deepEqual(
      history.map((h) => [h.from_status, h.to_status]),
      [[null, 'OPEN'], ['OPEN', 'ASSIGNED'], ['ASSIGNED', 'IN_PROGRESS'], ['IN_PROGRESS', 'COMPLETED']],
    );
    assert.equal(history.at(-1).note, 'done');
  });

  it('lists an asset\'s maintenance history', async () => {
    const { api, createAsset, workOrderBody } = setup();
    const [a, b] = [await createAsset(), await createAsset()];
    await api.post('/api/work-orders').send(workOrderBody(a));
    await api.post('/api/work-orders').send(workOrderBody(a));
    await api.post('/api/work-orders').send(workOrderBody(b));
    const res = await api.get(`/api/assets/${a.id}/work-orders`);
    assert.equal(res.body.total, 2);
  });
});

describe('work orders: filtering and search', () => {
  async function seed() {
    const ctx = setup();
    const { api, createAsset, createTechnician, workOrderBody } = ctx;
    const [a1, a2] = [await createAsset(), await createAsset()];
    const tech = await createTechnician();
    await api.post('/api/work-orders').send(workOrderBody(a1, { priority: 'HIGH', description: 'Seal leak' }));
    await api.post('/api/work-orders').send(workOrderBody(a1, { priority: 'LOW', technician_id: tech.id }));
    const wo3 = (await api.post('/api/work-orders').send(workOrderBody(a2, { priority: 'CRITICAL', technician_id: tech.id }))).body;
    await api.put(`/api/work-orders/${wo3.id}`).send({ status: 'IN_PROGRESS' });
    return { ...ctx, a1, a2, tech };
  }

  it('filters by status, priority, asset and technician', async () => {
    const { api, a1, tech } = await seed();
    assert.equal((await api.get('/api/work-orders')).body.total, 3);
    assert.equal((await api.get('/api/work-orders?status=IN_PROGRESS')).body.total, 1);
    assert.equal((await api.get('/api/work-orders?status=in_progress')).body.total, 1);
    assert.equal((await api.get('/api/work-orders?priority=HIGH')).body.total, 1);
    assert.equal((await api.get(`/api/work-orders?asset_id=${a1.id}`)).body.total, 2);
    assert.equal((await api.get(`/api/work-orders?technician_id=${tech.id}`)).body.total, 2);
    assert.equal((await api.get(`/api/work-orders?technician_id=${tech.id}&priority=LOW`)).body.total, 1);
  });

  it('searches number, description, asset code and technician name', async () => {
    const { api, a2 } = await seed();
    assert.equal((await api.get('/api/work-orders?q=seal')).body.total, 1);
    assert.equal((await api.get(`/api/work-orders?q=${a2.asset_code}`)).body.total, 1);
    assert.equal((await api.get('/api/work-orders?q=WO-1002')).body.total, 1);
    assert.equal((await api.get('/api/work-orders?q=ravi')).body.total, 2);
  });

  it('rejects invalid filter values', async () => {
    const { api } = setup();
    expectRule(await api.get('/api/work-orders?status=DONE'), 400, 'VALIDATION_ERROR');
    expectRule(await api.get('/api/work-orders?asset_id=abc'), 400, 'VALIDATION_ERROR');
  });
});
