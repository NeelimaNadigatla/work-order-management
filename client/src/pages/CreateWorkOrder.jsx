import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { navigate } from '../navigation.js';
import { ErrorBox, PRIORITIES, label, todayLocal } from '../components.jsx';

const EMPTY = {
  work_order_number: '',
  asset_id: '',
  maintenance_type_id: '',
  priority: 'MEDIUM',
  technician_id: '',
  scheduled_date: todayLocal(),
  description: '',
};

export default function CreateWorkOrder() {
  const [form, setForm] = useState(EMPTY);
  const [assets, setAssets] = useState([]);
  const [types, setTypes] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.listAssets(), api.listMaintenanceTypes(), api.listTechnicians({ status: 'ACTIVE' })])
      .then(([a, t, techs]) => {
        setAssets(a);
        setTypes(t);
        setTechnicians(techs);
      })
      .catch(setError);
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // Hints mirror the server rules so users learn before submitting; the server remains the authority.
  const asset = assets.find((a) => String(a.id) === form.asset_id);
  const type = types.find((t) => String(t.id) === form.maintenance_type_id);
  const hints = useMemo(() => {
    const list = [];
    if (form.priority === 'CRITICAL' && !form.technician_id) list.push('CRITICAL work orders need an assigned technician.');
    if (asset?.status === 'OUT_OF_SERVICE' && type && !type.is_emergency) {
      list.push(`${asset.asset_code} is OUT OF SERVICE: only emergency maintenance types are allowed.`);
    }
    if (form.scheduled_date && form.scheduled_date < todayLocal()) list.push('Scheduled date cannot be in the past.');
    return list;
  }, [form, asset, type]);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        asset_id: Number(form.asset_id),
        maintenance_type_id: Number(form.maintenance_type_id),
        priority: form.priority,
        scheduled_date: form.scheduled_date,
        description: form.description,
        technician_id: form.technician_id ? Number(form.technician_id) : null,
      };
      if (form.work_order_number.trim()) body.work_order_number = form.work_order_number.trim();
      const created = await api.createWorkOrder(body);
      navigate(`/work-orders/${created.id}`);
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }

  return (
    <section className="narrow">
      <a href="#/" className="back">
        ← Back to work orders
      </a>
      <h1>New Work Order</h1>

      <form className="card form" onSubmit={submit}>
        <label>
          Work order number
          <input value={form.work_order_number} onChange={set('work_order_number')} placeholder="Leave blank to auto-generate" />
        </label>

        <label>
          Asset *
          <select value={form.asset_id} onChange={set('asset_id')} required>
            <option value="">Select an asset…</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id} disabled={a.status === 'RETIRED'}>
                {a.asset_code} — {a.asset_type} ({label(a.status)})
              </option>
            ))}
          </select>
        </label>

        <label>
          Maintenance type *
          <select value={form.maintenance_type_id} onChange={set('maintenance_type_id')} required>
            <option value="">Select a type…</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.is_emergency ? ' (emergency)' : ''}
              </option>
            ))}
          </select>
        </label>

        <div className="row">
          <label>
            Priority *
            <select value={form.priority} onChange={set('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <label>
            Scheduled date *
            <input type="date" value={form.scheduled_date} min={todayLocal()} onChange={set('scheduled_date')} required />
          </label>
        </div>

        <label>
          Technician {form.priority === 'CRITICAL' ? '*' : '(optional)'}
          <select value={form.technician_id} onChange={set('technician_id')} required={form.priority === 'CRITICAL'}>
            <option value="">Unassigned</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {t.skill}
              </option>
            ))}
          </select>
        </label>

        <label>
          Description *
          <textarea rows={4} value={form.description} onChange={set('description')} required maxLength={2000} />
        </label>

        {hints.length > 0 && (
          <ul className="hints">
            {hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        )}

        <ErrorBox error={error} />

        <div className="actions">
          <button type="button" onClick={() => navigate('/')}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? 'Creating…' : 'Create work order'}
          </button>
        </div>
      </form>
    </section>
  );
}
