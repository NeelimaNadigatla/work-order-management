import express from 'express';
import { ZodError } from 'zod';
import { AppError } from './errors.js';
import { createAssetService } from './services/assetService.js';
import { createTechnicianService } from './services/technicianService.js';
import { createWorkOrderService } from './services/workOrderService.js';
import {
  assetCreate,
  assetListQuery,
  assetUpdate,
  idParam,
  technicianCreate,
  technicianListQuery,
  technicianUpdate,
  workOrderCreate,
  workOrderListQuery,
  workOrderUpdate,
} from './validation.js';

export function createApp({ db, clock = () => new Date() }) {
  const assets = createAssetService({ db, clock });
  const technicians = createTechnicianService({ db, clock });
  const workOrders = createWorkOrderService({ db, clock });

  const app = express();
  app.use(express.json({ limit: '100kb' }));

  const id = (req) => idParam.parse(req.params.id);

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  // Assets
  app.post('/api/assets', (req, res) => res.status(201).json(assets.create(assetCreate.parse(req.body))));
  app.get('/api/assets', (req, res) => res.json(assets.list(assetListQuery.parse(req.query))));
  app.get('/api/assets/:id', (req, res) => res.json(assets.get(id(req))));
  app.put('/api/assets/:id', (req, res) => res.json(assets.update(id(req), assetUpdate.parse(req.body))));
  // Maintenance history for an asset
  app.get('/api/assets/:id/work-orders', (req, res) => {
    const assetId = assets.get(id(req)).id;
    res.json(workOrders.list(workOrderListQuery.parse({ ...req.query, asset_id: assetId })));
  });

  // Technicians
  app.post('/api/technicians', (req, res) =>
    res.status(201).json(technicians.create(technicianCreate.parse(req.body))),
  );
  app.get('/api/technicians', (req, res) => res.json(technicians.list(technicianListQuery.parse(req.query))));
  app.get('/api/technicians/:id', (req, res) => res.json(technicians.get(id(req))));
  app.put('/api/technicians/:id', (req, res) =>
    res.json(technicians.update(id(req), technicianUpdate.parse(req.body))),
  );

  // Maintenance types (lookup data)
  app.get('/api/maintenance-types', (req, res) =>
    res.json(
      db
        .prepare('SELECT id, code, name, is_emergency FROM maintenance_types ORDER BY name')
        .all()
        .map((t) => ({ ...t, is_emergency: Boolean(t.is_emergency) })),
    ),
  );

  // Work orders
  app.post('/api/work-orders', (req, res) =>
    res.status(201).json(workOrders.create(workOrderCreate.parse(req.body))),
  );
  app.get('/api/work-orders', (req, res) => res.json(workOrders.list(workOrderListQuery.parse(req.query))));
  app.get('/api/work-orders/:id', (req, res) => res.json(workOrders.get(id(req))));
  app.put('/api/work-orders/:id', (req, res) =>
    res.json(workOrders.update(id(req), workOrderUpdate.parse(req.body))),
  );
  app.get('/api/work-orders/:id/history', (req, res) => res.json(workOrders.history(id(req))));

  app.use('/api', (req, res) =>
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` } }),
  );

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const send = (status, code, message, details) => res.status(status).json({ error: { code, message, details } });

    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ field: i.path.join('.') || null, message: i.message }));
      return send(400, 'VALIDATION_ERROR', 'Request validation failed', details);
    }
    if (err instanceof AppError) return send(err.status, err.code, err.message, err.details);
    if (err.type === 'entity.parse.failed') return send(400, 'INVALID_JSON', 'Request body is not valid JSON');
    // Database constraints are the safety net behind the service-layer checks.
    if (err.code === 'ERR_SQLITE_ERROR') {
      if (/UNIQUE constraint/.test(err.message)) return send(409, 'CONSTRAINT_VIOLATION', err.message);
      if (/CHECK constraint|FOREIGN KEY|terminal status/.test(err.message)) {
        return send(422, 'CONSTRAINT_VIOLATION', err.message);
      }
    }
    console.error(err);
    return send(500, 'INTERNAL_ERROR', 'Something went wrong');
  });

  return app;
}
