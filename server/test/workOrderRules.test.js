import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAssetAcceptsWorkOrder,
  assertCriticalHasTechnician,
  assertScheduleNotInPast,
  assertTransition,
  toLocalDateString,
} from '../src/domain/workOrderRules.js';

const throwsCode = (fn, code) => assert.throws(fn, (err) => err.code === code && err.status === 422);

describe('status transitions', () => {
  it('allows the happy path', () => {
    assertTransition('OPEN', 'ASSIGNED');
    assertTransition('ASSIGNED', 'IN_PROGRESS');
    assertTransition('IN_PROGRESS', 'COMPLETED');
  });

  it('allows cancellation only from OPEN and ASSIGNED', () => {
    assertTransition('OPEN', 'CANCELLED');
    assertTransition('ASSIGNED', 'CANCELLED');
    throwsCode(() => assertTransition('IN_PROGRESS', 'CANCELLED'), 'INVALID_STATUS_TRANSITION');
  });

  it('does not allow skipping states', () => {
    throwsCode(() => assertTransition('OPEN', 'IN_PROGRESS'), 'INVALID_STATUS_TRANSITION');
    throwsCode(() => assertTransition('OPEN', 'COMPLETED'), 'INVALID_STATUS_TRANSITION');
  });

  it('Rule 3: COMPLETED cannot go back to OPEN (or anywhere)', () => {
    throwsCode(() => assertTransition('COMPLETED', 'OPEN'), 'COMPLETED_IS_FINAL');
    throwsCode(() => assertTransition('COMPLETED', 'IN_PROGRESS'), 'COMPLETED_IS_FINAL');
  });

  it('Rule 4: CANCELLED cannot move to IN_PROGRESS (or anywhere)', () => {
    throwsCode(() => assertTransition('CANCELLED', 'IN_PROGRESS'), 'CANCELLED_IS_FINAL');
    throwsCode(() => assertTransition('CANCELLED', 'OPEN'), 'CANCELLED_IS_FINAL');
  });
});

describe('Rule 2: critical work', () => {
  it('requires a technician for CRITICAL only', () => {
    throwsCode(() => assertCriticalHasTechnician('CRITICAL', null), 'CRITICAL_REQUIRES_TECHNICIAN');
    throwsCode(() => assertCriticalHasTechnician('CRITICAL', undefined), 'CRITICAL_REQUIRES_TECHNICIAN');
    assertCriticalHasTechnician('CRITICAL', 7);
    assertCriticalHasTechnician('HIGH', null);
  });
});

describe('Rule 5: schedule', () => {
  it('rejects past dates and accepts today', () => {
    throwsCode(() => assertScheduleNotInPast('2026-06-14', '2026-06-15'), 'SCHEDULED_DATE_IN_PAST');
    assertScheduleNotInPast('2026-06-15', '2026-06-15');
    assertScheduleNotInPast('2027-01-01', '2026-06-15');
  });

  it('formats "today" in local time, not UTC', () => {
    assert.equal(toLocalDateString(new Date(2026, 0, 5, 0, 30)), '2026-01-05');
  });
});

describe('Rule 6: asset status', () => {
  const routine = { is_emergency: 0 };
  const emergency = { is_emergency: 1 };

  it('blocks non-emergency work on OUT_OF_SERVICE assets', () => {
    throwsCode(
      () => assertAssetAcceptsWorkOrder({ asset_code: 'A', status: 'OUT_OF_SERVICE' }, routine),
      'ASSET_OUT_OF_SERVICE',
    );
  });

  it('allows emergency work on OUT_OF_SERVICE assets', () => {
    assertAssetAcceptsWorkOrder({ asset_code: 'A', status: 'OUT_OF_SERVICE' }, emergency);
  });

  it('allows any work on ACTIVE assets and none on RETIRED ones', () => {
    assertAssetAcceptsWorkOrder({ asset_code: 'A', status: 'ACTIVE' }, routine);
    throwsCode(() => assertAssetAcceptsWorkOrder({ asset_code: 'A', status: 'RETIRED' }, emergency), 'ASSET_RETIRED');
  });
});
