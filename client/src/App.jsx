import { useEffect, useState } from 'react';
import WorkOrderList from './pages/WorkOrderList.jsx';
import CreateWorkOrder from './pages/CreateWorkOrder.jsx';
import WorkOrderDetails from './pages/WorkOrderDetails.jsx';

// Three screens don't need a router library; a hash route keeps refresh/back working.
function useHashPath() {
  const read = () => window.location.hash.replace(/^#/, '') || '/';
  const [path, setPath] = useState(read);
  useEffect(() => {
    const onChange = () => setPath(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return path;
}

export default function App() {
  const path = useHashPath();
  const detailMatch = path.match(/^\/work-orders\/(\d+)$/);

  let page;
  if (path === '/new') page = <CreateWorkOrder />;
  else if (detailMatch) page = <WorkOrderDetails id={Number(detailMatch[1])} />;
  else page = <WorkOrderList />;

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">
          Maintenance Work Orders
        </a>
      </header>
      <main className="container">{page}</main>
    </div>
  );
}
