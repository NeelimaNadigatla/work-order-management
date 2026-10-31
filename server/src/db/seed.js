// Resets the database and loads sample data through the services, so seed data obeys the same rules as the API.
import { rmSync } from 'node:fs';
import { DB_FILE } from '../config.js';
import { openDatabase } from './index.js';
import { createAssetService } from '../services/assetService.js';
import { createTechnicianService } from '../services/technicianService.js';
import { createWorkOrderService } from '../services/workOrderService.js';
import { toLocalDateString } from '../domain/workOrderRules.js';

for (const suffix of ['', '-wal', '-shm']) rmSync(DB_FILE + suffix, { force: true });

const db = openDatabase(DB_FILE);
const clock = () => new Date();
const assets = createAssetService({ db, clock });
const technicians = createTechnicianService({ db, clock });
const workOrders = createWorkOrderService({ db, clock });

const inDays = (n) => toLocalDateString(new Date(Date.now() + n * 86_400_000));
const type = Object.fromEntries(db.prepare('SELECT code, id FROM maintenance_types').all().map((t) => [t.code, t.id]));

const asset = (asset_code, asset_type, manufacturer, model, serial_number, usage_hours, usage_cycles, status = 'ACTIVE') =>
  assets.create({ asset_code, asset_type, manufacturer, model, serial_number, usage_hours, usage_cycles, status });

const a1 = asset('AST-1024', 'Hydraulic Pump', 'Parker', 'PV180', 'PK-88231', 12450, 3100);
const a2 = asset('AST-1038', 'Air Compressor', 'Atlas Copco', 'GA37', 'AC-55102', 8800, 1420);
const a3 = asset('AST-1082', 'Turbine Engine', 'Rolls-Royce', 'RB211', 'RR-21177', 30500, 9870);
const a4 = asset('AST-1101', 'Forklift', 'Toyota', '8FGU25', 'TY-77310', 4200, 0, 'OUT_OF_SERVICE');
asset('AST-1150', 'Generator', 'Cummins', 'C150D5', 'CM-10992', 1500, 210);

const t1 = technicians.create({ name: 'Ravi Kumar', skill: 'Hydraulics', status: 'ACTIVE' });
const t2 = technicians.create({ name: 'Anjali Sharma', skill: 'Avionics / Engines', status: 'ACTIVE' });
const t3 = technicians.create({ name: 'Mohammed Irfan', skill: 'Electrical', status: 'ACTIVE' });
technicians.create({ name: 'Priya Reddy', skill: 'Mechanical', status: 'ON_LEAVE' });

const wo = (input) => workOrders.create(input);

const w1 = wo({ asset_id: a1.id, maintenance_type_id: type.INSPECTION, priority: 'HIGH', technician_id: t1.id, scheduled_date: inDays(1), description: 'Quarterly pressure and seal inspection.' });
workOrders.update(w1.id, { status: 'IN_PROGRESS', note: 'Technician on site' });

wo({ asset_id: a2.id, maintenance_type_id: type.REPAIR, priority: 'MEDIUM', scheduled_date: inDays(3), description: 'Compressor trips on overload after ~20 minutes of operation.' });

wo({ asset_id: a3.id, maintenance_type_id: type.INSPECTION, priority: 'CRITICAL', technician_id: t2.id, scheduled_date: inDays(0), description: 'Borescope inspection after bird-strike report.' });

const w4 = wo({ asset_id: a1.id, maintenance_type_id: type.SERVICING, priority: 'LOW', technician_id: t1.id, scheduled_date: inDays(0), description: 'Replace hydraulic fluid and filters.' });
workOrders.update(w4.id, { status: 'IN_PROGRESS' });
workOrders.update(w4.id, { status: 'COMPLETED', note: 'Fluid and filters replaced, no leaks found' });

const w5 = wo({ asset_id: a2.id, maintenance_type_id: type.SERVICING, priority: 'LOW', scheduled_date: inDays(7), description: 'Annual service - superseded by repair order.' });
workOrders.update(w5.id, { status: 'CANCELLED', note: 'Superseded by repair work order' });

wo({ asset_id: a4.id, maintenance_type_id: type.EMERGENCY_REPAIR, priority: 'CRITICAL', technician_id: t3.id, scheduled_date: inDays(0), description: 'Mast hydraulic failure - forklift out of service.' });

console.log(`Seeded ${DB_FILE}`);
