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
import EvacBoard from './pages/EvacBoard'; // 다올 상황실 (2026-10-26)
import EvacReport from './pages/EvacReport'; // 다올 대피 결과 보고 (2026-10-26)
import TgEntry from './pages/TgEntry'; // 온다 텔레그램판 미니 앱 (2026-11-22)
import TgHelper from './pages/TgHelper';
import TgHome from './pages/TgHome';

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
          <Route path="/admin/evac" element={<AdminRoute><EvacBoard /></AdminRoute>} />
          <Route path="/admin/evac/report/:id" element={<AdminRoute><EvacReport /></AdminRoute>} />
          <Route path="/tg" element={<TgEntry />} />
          <Route path="/tg/helper" element={<ProtectedRoute><TgHelper /></ProtectedRoute>} />
          <Route path="/tg/home" element={<ProtectedRoute><TgHome /></ProtectedRoute>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
