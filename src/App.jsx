import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
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
import EsopAdminGuard from '@/components/admin/EsopAdminGuard';
import PlatformSuperAdminGuard from '@/components/admin/PlatformSuperAdminGuard';
import { PlatformProvider } from '@/lib/PlatformContext';

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

  // Platform Super Admins may access /admin/* routes without a CompanyMembership.
  // They are not redirected to NoCompanyScreen — platform routes are independent
  // of company context. The route guard (PlatformSuperAdminGuard) handles
  // auth enforcement on those routes.
  if (!hasCompany && !isPlatformSuperAdmin) {
    return <NoCompanyScreen />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Jobs />} />
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
      {/* Essential SOP Admin — internal platform administration only */}
      <Route path="/admin/master-library" element={<EsopAdminGuard><MasterLibrary /></EsopAdminGuard>} />
      <Route path="/admin/master-library/:masterId" element={<EsopAdminGuard><MasterSOPEditor /></EsopAdminGuard>} />
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