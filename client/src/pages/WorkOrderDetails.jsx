import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { ErrorBox, PriorityBadge, StatusBadge, formatDateTime, label } from '../components.jsx';

const ACTION_LABELS = {
  IN_PROGRESS: 'Start work',
  COMPLETED: 'Mark completed',
  CANCELLED: 'Cancel work order',
};

export default function WorkOrderDetails({ id }) {
  const [wo, setWo] = useState(null);
  const [history, setHistory] = useState([]);
  const [assetHistory, setAssetHistory] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [technicianId, setTechnicianId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const order = await api.getWorkOrder(id);
      const [h, assetOrders] = await Promise.all([
        api.getWorkOrderHistory(id),
        api.listAssetWorkOrders(order.asset.id),
      ]);
      setWo(order);
      setHistory(h);
      setAssetHistory(assetOrders.data.filter((o) => o.id !== order.id));
      setTechnicianId(order.technician ? String(order.technician.id) : '');
    } catch (err) {
      setLoadError(err);
    }
  }, [id]);

  useEffect(() => {
    load();
    api.listTechnicians({ status: 'ACTIVE' }).then(setTechnicians).catch(() => {});
  }, [load]);

  async function update(body, confirmMessage) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateWorkOrder(id, { ...body, ...(note.trim() ? { note: note.trim() } : {}) });
      setNote('');
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <section>
        <a href="#/" className="back">
          ← Back to work orders
        </a>
        <ErrorBox error={loadError} />
      </section>
    );
  }
  if (!wo) return <p className="muted">Loading…</p>;

  const canChangeTechnician = ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(wo.status);
  const technicianChanged = technicianId !== (wo.technician ? String(wo.technician.id) : '');
  const statusActions = wo.allowed_transitions.filter((s) => s !== 'ASSIGNED');

  return (
    <section>
      <a href="#/" className="back">
        ← Back to work orders
      </a>
      <div className="page-header">
        <h1>
          {wo.work_order_number} <StatusBadge status={wo.status} />
        </h1>
      </div>

      <div className="grid">
        <div className="card">
          <h2>Work order</h2>
          <dl>
            <dt>Priority</dt>
            <dd>
              <PriorityBadge priority={wo.priority} />
            </dd>
            <dt>Maintenance type</dt>
            <dd>
              {wo.maintenance_type.name}
              {wo.maintenance_type.is_emergency && <span className="badge priority-critical tag">Emergency</span>}
            </dd>
            <dt>Description</dt>
            <dd className="pre">{wo.description}</dd>
          </dl>
        </div>

        <div className="card">
          <h2>Asset</h2>
          <dl>
            <dt>Asset ID</dt>
            <dd>{wo.asset.asset_code}</dd>
            <dt>Type</dt>
            <dd>{wo.asset.asset_type}</dd>
            <dt>Make / model</dt>
            <dd>
              {wo.asset.manufacturer} {wo.asset.model}
            </dd>
            <dt>Asset status</dt>
            <dd>{label(wo.asset.status)}</dd>
          </dl>
        </div>

        <div className="card">
          <h2>Dates</h2>
          <dl>
            <dt>Scheduled</dt>
            <dd>{wo.scheduled_date}</dd>
            <dt>Created</dt>
            <dd>{formatDateTime(wo.created_at)}</dd>
            <dt>Started</dt>
            <dd>{formatDateTime(wo.started_at)}</dd>
            <dt>Completed</dt>
            <dd>{formatDateTime(wo.completed_at)}</dd>
            {wo.cancelled_at && (
              <>
                <dt>Cancelled</dt>
                <dd>{formatDateTime(wo.cancelled_at)}</dd>
              </>
            )}
          </dl>
        </div>

        <div className="card">
          <h2>Technician</h2>
          {canChangeTechnician ? (
            <div className="assign">
              <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} aria-label="Technician">
                {wo.status === 'OPEN' && <option value="">Unassigned</option>}
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.skill}
                  </option>
                ))}
              </select>
              <button
                disabled={busy || !technicianChanged || !technicianId}
                onClick={() => update({ technician_id: Number(technicianId) })}
              >
                {wo.technician ? 'Reassign' : 'Assign'}
              </button>
            </div>
          ) : (
            <p>{wo.technician ? `${wo.technician.name} — ${wo.technician.skill}` : 'Unassigned'}</p>
          )}
          {wo.status === 'OPEN' && <p className="muted small">Assigning a technician moves the order to ASSIGNED.</p>}
        </div>
      </div>

      <div className="card">
        <h2>Status</h2>
        {statusActions.length === 0 ? (
          <p className="muted">This work order is {label(wo.status)} and can no longer change.</p>
        ) : (
          <>
            <input
              className="note"
              placeholder="Optional note for this change"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
            <div className="actions left">
              {statusActions.map((s) => (
                <button
                  key={s}
                  className={s === 'CANCELLED' ? 'danger' : 'primary'}
                  disabled={busy}
                  onClick={() =>
                    update({ status: s }, s === 'CANCELLED' ? 'Cancel this work order? This cannot be undone.' : null)
                  }
                >
                  {ACTION_LABELS[s]}
                </button>
              ))}
            </div>
          </>
        )}
        <ErrorBox error={error} />
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Status history</h2>
          <ol className="timeline">
            {history.map((h) => (
              <li key={h.id}>
                <strong>{h.from_status ? `${label(h.from_status)} → ${label(h.to_status)}` : `Created as ${label(h.to_status)}`}</strong>
                <span className="muted small"> {formatDateTime(h.changed_at)}</span>
                {h.technician_name && <div className="small">Technician: {h.technician_name}</div>}
                {h.note && <div className="small">{h.note}</div>}
              </li>
            ))}
          </ol>
        </div>

        <div className="card">
          <h2>Other work on {wo.asset.asset_code}</h2>
          {assetHistory.length === 0 ? (
            <p className="muted">No other work orders for this asset.</p>
          ) : (
            <ul className="plain">
              {assetHistory.map((o) => (
                <li key={o.id}>
                  <a href={`#/work-orders/${o.id}`}>{o.work_order_number}</a> · {o.maintenance_type.name} ·{' '}
                  <StatusBadge status={o.status} /> <span className="muted small">{o.scheduled_date}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
