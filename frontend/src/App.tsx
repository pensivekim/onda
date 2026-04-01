import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute, AdminRoute } from './components/ProtectedRoute';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RequesterHome from './pages/RequesterHome';
import CreateRequest from './pages/CreateRequest';
import RequestStatus from './pages/RequestStatus';
import ResponderHome from './pages/ResponderHome';
import MatchDetail from './pages/MatchDetail';
import AdminDashboard from './pages/AdminDashboard';
import WalletPage from './pages/WalletPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/requester" element={<ProtectedRoute><RequesterHome /></ProtectedRoute>} />
          <Route path="/requester/request" element={<ProtectedRoute><CreateRequest /></ProtectedRoute>} />
          <Route path="/requester/status/:id" element={<ProtectedRoute><RequestStatus /></ProtectedRoute>} />
          <Route path="/responder" element={<ProtectedRoute><ResponderHome /></ProtectedRoute>} />
          <Route path="/responder/match/:id" element={<ProtectedRoute><MatchDetail /></ProtectedRoute>} />
          <Route path="/wallet" element={<ProtectedRoute><WalletPage /></ProtectedRoute>} />
          <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
