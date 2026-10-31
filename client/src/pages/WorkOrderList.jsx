import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { navigate } from '../navigation.js';
import { ErrorBox, PRIORITIES, PriorityBadge, STATUSES, StatusBadge, label } from '../components.jsx';

export default function WorkOrderList() {
  const [filters, setFilters] = useState({ q: '', status: '', priority: '' });
  const [debouncedQ, setDebouncedQ] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(filters.q.trim()), 300);
    return () => clearTimeout(t);
  }, [filters.q]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .listWorkOrders({ q: debouncedQ, status: filters.status, priority: filters.priority, limit: 200 })
      .then((r) => !cancelled && setResult(r))
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, filters.status, filters.priority]);

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));

  return (
    <section>
      <div className="page-header">
        <h1>Work Orders</h1>
        <button className="primary" onClick={() => navigate('/new')}>
          + New
        </button>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search number, asset, description, technician…"
          value={filters.q}
          onChange={set('q')}
          aria-label="Search"
        />
        <select value={filters.status} onChange={set('status')} aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
        <select value={filters.priority} onChange={set('priority')} aria-label="Priority">
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <ErrorBox error={error} />

      {!result && !error && <p className="muted">Loading…</p>}

      {result && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Work Order</th>
                  <th>Asset</th>
                  <th>Type</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Technician</th>
                  <th>Scheduled</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((wo) => (
                  <tr key={wo.id} className="clickable" onClick={() => navigate(`/work-orders/${wo.id}`)}>
                    <td>
                      <a href={`#/work-orders/${wo.id}`} onClick={(e) => e.stopPropagation()}>
                        {wo.work_order_number}
                      </a>
                    </td>
                    <td>{wo.asset.asset_code}</td>
                    <td>{wo.maintenance_type.name}</td>
                    <td>
                      <PriorityBadge priority={wo.priority} />
                    </td>
                    <td>
                      <StatusBadge status={wo.status} />
                    </td>
                    <td>{wo.technician?.name ?? <span className="muted">Unassigned</span>}</td>
                    <td>{wo.scheduled_date}</td>
                  </tr>
                ))}
                {result.data.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted center">
                      No work orders match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Showing {result.data.length} of {result.total}
          </p>
        </>
      )}
    </section>
  );
}
