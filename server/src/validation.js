import { z } from 'zod';
import { ASSET_STATUSES, PRIORITIES, TECHNICIAN_STATUSES, WORK_ORDER_STATUSES } from './domain/enums.js';

const id = z.coerce.number().int().positive();
const text = (max) => z.string().trim().min(1, 'is required').max(max);
const upper = (s) => s.toUpperCase();
// Accept "in_progress" in query strings, but store/compare upper case.
const enumOf = (values) => z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), z.enum(values));

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'must be a valid calendar date');

const atLeastOneField = (obj) => Object.keys(obj).length > 0;

const assetFields = {
  asset_code: text(30).transform(upper),
  asset_type: text(100),
  manufacturer: text(100),
  model: text(100),
  serial_number: text(100),
  usage_hours: z.number().nonnegative(),
  usage_cycles: z.number().int().nonnegative(),
  status: enumOf(ASSET_STATUSES),
};

export const assetCreate = z
  .object({
    ...assetFields,
    usage_hours: assetFields.usage_hours.default(0),
    usage_cycles: assetFields.usage_cycles.default(0),
    status: assetFields.status.default('ACTIVE'),
  })
  .strict();

export const assetUpdate = z.object(assetFields).partial().strict().refine(atLeastOneField, 'No fields to update');

export const assetListQuery = z.object({
  status: enumOf(ASSET_STATUSES).optional(),
  q: z.string().trim().optional(),
});

const technicianFields = {
  name: text(100),
  skill: text(100),
  status: enumOf(TECHNICIAN_STATUSES),
};

export const technicianCreate = z
  .object({ ...technicianFields, status: technicianFields.status.default('ACTIVE') })
  .strict();

export const technicianUpdate = z
  .object(technicianFields)
  .partial()
  .strict()
  .refine(atLeastOneField, 'No fields to update');

export const technicianListQuery = z.object({
  status: enumOf(TECHNICIAN_STATUSES).optional(),
  q: z.string().trim().optional(),
});

const workOrderNumber = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]{2,29}$/, 'must be 3-30 letters, digits or dashes')
  .transform(upper);

export const workOrderCreate = z
  .object({
    work_order_number: workOrderNumber.optional(),
    asset_id: id,
    maintenance_type_id: id,
    description: text(2000),
    priority: enumOf(PRIORITIES),
    technician_id: id.nullable().optional(),
    scheduled_date: isoDate,
  })
  .strict();

// asset_id is intentionally not updatable: a work order belongs to one asset for life.
export const workOrderUpdate = z
  .object({
    work_order_number: workOrderNumber,
    maintenance_type_id: id,
    description: text(2000),
    priority: enumOf(PRIORITIES),
    technician_id: id.nullable(),
    scheduled_date: isoDate,
    status: enumOf(WORK_ORDER_STATUSES),
    note: z.string().trim().max(500),
  })
  .partial()
  .strict()
  .refine(atLeastOneField, 'No fields to update');

export const workOrderListQuery = z.object({
  status: enumOf(WORK_ORDER_STATUSES).optional(),
  priority: enumOf(PRIORITIES).optional(),
  asset_id: id.optional(),
  technician_id: id.optional(),
  maintenance_type_id: id.optional(),
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const idParam = id;
