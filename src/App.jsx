import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { ThemeProvider } from '@/lib/ThemeContext';
import { CompanyProvider } from '@/lib/CompanyContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import NoCompanyScreen from '@/components/NoCompanyScreen';
import ScrollToTop from './components/ScrollToTop';
import { AppProvider, useApp } from '@/lib/AppContext';
import { useCompany } from '@/lib/CompanyContext';
import Layout from '@/components/Layout';
import Jobs from '@/pages/Jobs';
import JobDetail from '@/pages/JobDetail';
import SectionDetail from '@/pages/SectionDetail';
import CreateJob from '@/pages/CreateJob';
import Assistant from '@/pages/Assistant';
import Profile from '@/pages/Profile';
import PrivacyPolicy from '@/pages/PrivacyPolicy';
import TermsOfService from '@/pages/TermsOfService';
import DeletionRequests from '@/pages/DeletionRequests';
import Subscription from '@/pages/Subscription';
import Plans from '@/pages/Plans';
import TeamMembers from '@/pages/TeamMembers';
import RequestsAndReviews from '@/pages/RequestsAndReviews';
import EditRequests from '@/pages/EditRequests';
import ActivityHistory from '@/pages/ActivityHistory';
import Notifications from '@/pages/Notifications';
import AcceptInvitation from '@/pages/AcceptInvitation';
import CompanyProfile from '@/pages/CompanyProfile';
import RoleLabels from '@/pages/RoleLabels';
import OwnershipAndAccount from '@/pages/OwnershipAndAccount';
import MasterLibrary from '@/pages/admin/MasterLibrary';
import MasterSOPEditor from '@/pages/admin/MasterSOPEditor';
import PlatformSuperAdminGuard from '@/components/admin/PlatformSuperAdminGuard';
import { PlatformProvider } from '@/lib/PlatformContext';
import PlatformLayout from '@/components/platform/PlatformLayout';
import PlatformGuard from '@/components/platform/PlatformGuard';
import PlatformDashboard from '@/pages/platform/PlatformDashboard';
import PlatformAdmins from '@/pages/platform/PlatformAdmins';
import PlatformAuditLog from '@/pages/platform/PlatformAuditLog';
import PlatformCompanies from '@/pages/platform/PlatformCompanies';
import PlatformBootstrap from '@/pages/platform/PlatformBootstrap';
import MasterJobDetail from '@/pages/platform/MasterJobDetail';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <PlatformProvider>
      <CompanyProvider>
        <AppProvider>
          <SeededApp />
        </AppProvider>
      </CompanyProvider>
    </PlatformProvider>
  );
};

const SeededApp = () => {
  const { isReady, seedError, isPlatformSuperAdmin } = useApp();
  const { loadingCompany, hasCompany } = useCompany();

  if (seedError) {
    return (
      <div className="fixed inset-0 flex items-center justify-center p-4 text-center">
        <div>
          <p className="text-red-600 font-medium mb-2">Failed to initialize</p>
          <p className="text-sm text-neutral-500">{seedError}</p>
        </div>
      </div>
    );
  }

  if (loadingCompany || !isReady) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-neutral-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Platform Super Admins may access /platform/* routes without a CompanyMembership.
  // They are not redirected to NoCompanyScreen — platform routes are independent
  // of company context.
  if (!hasCompany && !isPlatformSuperAdmin) {
    return <NoCompanyScreen />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Redirect platform-only super admins away from the company workspace root */}
        <Route path="/" element={!hasCompany && isPlatformSuperAdmin ? <Navigate to="/platform" replace /> : <Jobs />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/jobs/:jobId" element={<JobDetail />} />
        <Route path="/jobs/:jobId/:sectionType" element={<SectionDetail />} />
        <Route path="/create-job" element={<CreateJob />} />
      </Route>
      {/* Legal pages — accessible without the bottom nav wrapper */}
      <Route path="/privacy-policy" element={<PrivacyPolicy />} />
      <Route path="/terms-of-service" element={<TermsOfService />} />
      <Route path="/admin/deletion-requests" element={<DeletionRequests />} />
      <Route path="/subscription" element={<Subscription />} />
      <Route path="/plans" element={<Plans />} />
      <Route path="/team" element={<TeamMembers />} />
      <Route path="/requests" element={<EditRequests />} />
      <Route path="/activity" element={<ActivityHistory />} />
      <Route path="/notifications" element={<Notifications />} />
      <Route path="/accept-invitation" element={<AcceptInvitation />} />
      <Route path="/company-profile" element={<CompanyProfile />} />
      <Route path="/role-labels" element={<RoleLabels />} />
      <Route path="/ownership" element={<OwnershipAndAccount />} />
      {/* Essential SOP Platform Admin — requires active PlatformMembership(SUPER_ADMIN) */}
      <Route path="/admin/master-library" element={<PlatformSuperAdminGuard><MasterLibrary /></PlatformSuperAdminGuard>} />
      <Route path="/admin/master-library/:masterId" element={<PlatformSuperAdminGuard><MasterSOPEditor /></PlatformSuperAdminGuard>} />
      {/* Platform Admin environment — /platform/* */}
      <Route path="/platform/bootstrap" element={<PlatformBootstrap />} />
      <Route element={<PlatformGuard><PlatformLayout /></PlatformGuard>}>
        {/* /platform lands on Master Jobs — the God Mode front door */}
        <Route path="/platform" element={<Navigate to="/platform/master-library" replace />} />
        <Route path="/platform/master-library" element={<MasterLibrary />} />
        <Route path="/platform/master-library/:masterId" element={<MasterJobDetail />} />
        <Route path="/platform/master-library/:masterId/edit" element={<MasterSOPEditor />} />
        <Route path="/platform/companies" element={<PlatformCompanies />} />
        <Route path="/platform/admins" element={<PlatformAdmins />} />
        <Route path="/platform/audit" element={<PlatformAuditLog />} />
        <Route path="/platform/profile" element={<PlatformDashboard />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <ThemeProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <ScrollToTop />
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App