async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error?.message ?? `Request failed (${res.status})`);
    err.code = data?.error?.code;
    err.details = data?.error?.details ?? [];
    throw err;
  }
  return data;
}

const query = (params) => {
  const entries = Object.entries(params).filter(([, v]) => v !== '' && v != null);
  return entries.length ? `?${new URLSearchParams(entries)}` : '';
};

export const api = {
  listWorkOrders: (params = {}) => request(`/work-orders${query(params)}`),
  getWorkOrder: (id) => request(`/work-orders/${id}`),
  getWorkOrderHistory: (id) => request(`/work-orders/${id}/history`),
  createWorkOrder: (body) => request('/work-orders', { method: 'POST', body }),
  updateWorkOrder: (id, body) => request(`/work-orders/${id}`, { method: 'PUT', body }),
  listAssets: () => request('/assets'),
  listAssetWorkOrders: (assetId) => request(`/assets/${assetId}/work-orders`),
  listTechnicians: (params = {}) => request(`/technicians${query(params)}`),
  listMaintenanceTypes: () => request('/maintenance-types'),
};
