// Route map — login at /, app shell under Layout, old /config URLs redirect into Admin tabs
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import CostDrivers from './pages/CostDrivers';
import Applications from './pages/Applications';
import ApplicationDetail from './pages/ApplicationDetail';
import Simulate from './pages/Simulate';
import Admin from './pages/Admin';
import AdminChangePassword from './pages/AdminChangePassword';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/login" element={<Navigate to="/" replace />} /> {/* legacy bookmarks */}
      <Route path="/admin/login" element={<Navigate to="/" replace />} />
      <Route path="/change-password" element={<AdminChangePassword />} />
      <Route path="/admin/change-password" element={<Navigate to="/change-password" replace />} />
      <Route path="/welcome" element={<Landing />} />
      <Route element={<Layout />}>
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="cost-drivers" element={<CostDrivers />} />
        <Route path="applications" element={<Applications />} />
        <Route path="applications/:id" element={<ApplicationDetail />} />
        <Route path="simulate" element={<Simulate />} />
        <Route path="admin" element={<Admin />} />
        <Route path="config" element={<Navigate to="/admin?tab=configuration" replace />} />
        <Route path="software-version" element={<Navigate to="/admin?tab=software-version" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
