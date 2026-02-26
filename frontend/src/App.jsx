import { Routes, Route, Navigate } from 'react-router-dom';
import DashboardLayout from './components/layout/DashboardLayout';
import DashboardPage from './pages/DashboardPage';
import LeadsTable from './components/LeadsTable';
import LeadsPage from './pages/LeadsPage';
import ConnectionsPage from './pages/ConnectionsPage';
import ProspectsPage from './pages/ProspectsPage';
import MyContactsPage from './pages/MyContactsPage';
import LeadDetailPage from './pages/LeadDetailPage';
import LeadSearchPage from './pages/LeadSearchPage';
import LeadImportPage from './pages/LeadImportPage';
import NetworkPage from './pages/NetworkPage';
import CampaignsPage from './pages/CampaignsPage';
import CampaignDetailPage from './pages/CampaignDetailPage';
import ImportsPage from './pages/ImportsPage';
import ContentEnginePage from './pages/ContentEnginePage';
import SettingsPage from './pages/SettingsPage';

function App() {
    return (
        <Routes>
            <Route path="/" element={<DashboardLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="lead-import" element={<LeadImportPage />} />
                <Route path="search" element={<LeadSearchPage />} />
                <Route path="connections" element={<ConnectionsPage />} />
                <Route path="prospects" element={<ProspectsPage />} />
                <Route path="my-contacts" element={<MyContactsPage />} />
                <Route path="leads" element={<LeadsPage />} />
                <Route path="leads/:id" element={<LeadDetailPage />} />
                <Route path="campaigns" element={<CampaignsPage />} />
                <Route path="campaigns/:id" element={<CampaignDetailPage />} />
                <Route path="network" element={<NetworkPage />} />
                <Route path="content" element={<ContentEnginePage />} />
                <Route path="approvals" element={<Navigate to="/campaigns" replace />} />
                <Route path="imports" element={<ImportsPage />} />
                <Route path="settings" element={<SettingsPage />} />

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
        </Routes>
    );
}

export default App;
