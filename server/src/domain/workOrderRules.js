// Pure business rules for work orders. No I/O, so they are trivially unit-testable
// and are the single place the API layer asks "is this allowed?".
import { ruleViolation } from '../errors.js';

export const TRANSITIONS = {
  OPEN: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const isTerminal = (status) => TRANSITIONS[status].length === 0;

export const allowedTransitions = (status) => TRANSITIONS[status];

export function assertTransition(from, to) {
  if (from === to) return;
  // Rule 3
  if (from === 'COMPLETED') {
    throw ruleViolation('COMPLETED_IS_FINAL', `A COMPLETED work order cannot be moved to ${to}`);
  }
  // Rule 4
  if (from === 'CANCELLED') {
    throw ruleViolation('CANCELLED_IS_FINAL', `A CANCELLED work order cannot be moved to ${to}`);
  }
  if (!TRANSITIONS[from].includes(to)) {
    throw ruleViolation(
      'INVALID_STATUS_TRANSITION',
      `Cannot move a work order from ${from} to ${to}. Allowed: ${TRANSITIONS[from].join(', ')}`,
    );
  }
}

// Rule 2
export function assertCriticalHasTechnician(priority, technicianId) {
  if (priority === 'CRITICAL' && technicianId == null) {
    throw ruleViolation('CRITICAL_REQUIRES_TECHNICIAN', 'A CRITICAL work order must have an assigned technician');
  }
}

// Rule 5. Dates are YYYY-MM-DD strings, so lexical comparison is chronological.
export function assertScheduleNotInPast(scheduledDate, today) {
  if (scheduledDate < today) {
    throw ruleViolation('SCHEDULED_DATE_IN_PAST', `Scheduled date ${scheduledDate} is in the past (today is ${today})`);
  }
}

// Rule 6 (plus: retired assets never receive new work).
export function assertAssetAcceptsWorkOrder(asset, maintenanceType) {
  if (asset.status === 'RETIRED') {
    throw ruleViolation('ASSET_RETIRED', `Asset ${asset.asset_code} is RETIRED and cannot receive work orders`);
  }
  if (asset.status === 'OUT_OF_SERVICE' && !maintenanceType.is_emergency) {
    throw ruleViolation(
      'ASSET_OUT_OF_SERVICE',
      `Asset ${asset.asset_code} is OUT_OF_SERVICE; only emergency maintenance types can be raised against it`,
    );
  }
}

export function toLocalDateString(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
