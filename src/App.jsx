import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { ThemeProvider } from '@/lib/ThemeContext';
import { CompanyProvider } from '@/lib/CompanyContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import NoCompanyScreen from '@/components/NoCompanyScreen';
import ScrollToTop from './components/ScrollToTop';
import { AppProvider, useApp } from '@/lib/AppContext';
import { useCompany } from '@/lib/CompanyContext';
import { lazy, Suspense } from 'react';
import Layout from '@/components/Layout';
import RouteFallback from '@/components/RouteFallback';
import PageTransition from '@/components/PageTransition';
import PlatformSuperAdminGuard from '@/components/admin/PlatformSuperAdminGuard';
import { PlatformProvider } from '@/lib/PlatformContext';
import PlatformLayout from '@/components/platform/PlatformLayout';
import PlatformGuard from '@/components/platform/PlatformGuard';
import Support from '@/pages/Support';

// Page-level routes are lazy-loaded so the initial bundle stays small and the
// first paint in a mobile WebView isn't blocked by code the user may never
// visit. Shell/layout/guard/provider components above stay eager. Each lazy
// page is caught by a Suspense boundary (RouteFallback) that is dark-mode +
// safe-area aware and never covers the fixed bottom nav.
const Jobs = lazy(() => import('@/pages/Jobs'));
const JobDetail = lazy(() => import('@/pages/JobDetail'));
const SectionDetail = lazy(() => import('@/pages/SectionDetail'));
const CreateJob = lazy(() => import('@/pages/CreateJob'));
const Assistant = lazy(() => import('@/pages/Assistant'));
const Profile = lazy(() => import('@/pages/Profile'));
const PrivacyPolicy = lazy(() => import('@/pages/PrivacyPolicy'));
const TermsOfService = lazy(() => import('@/pages/TermsOfService'));
const DeletionRequests = lazy(() => import('@/pages/DeletionRequests'));
const Subscription = lazy(() => import('@/pages/Subscription'));
const Plans = lazy(() => import('@/pages/Plans'));
const TeamMembers = lazy(() => import('@/pages/TeamMembers'));
const RequestsAndReviews = lazy(() => import('@/pages/RequestsAndReviews'));
const EditRequests = lazy(() => import('@/pages/EditRequests'));
const ActivityHistory = lazy(() => import('@/pages/ActivityHistory'));
const Notifications = lazy(() => import('@/pages/Notifications'));
const AcceptInvitation = lazy(() => import('@/pages/AcceptInvitation'));
const CompanyProfile = lazy(() => import('@/pages/CompanyProfile'));
const RoleLabels = lazy(() => import('@/pages/RoleLabels'));
const OwnershipAndAccount = lazy(() => import('@/pages/OwnershipAndAccount'));
const SyncSettings = lazy(() => import('@/pages/SyncSettings'));
const MasterLibrary = lazy(() => import('@/pages/admin/MasterLibrary'));
const MasterSOPEditor = lazy(() => import('@/pages/admin/MasterSOPEditor'));
const PlatformDashboard = lazy(() => import('@/pages/platform/PlatformDashboard'));
const PlatformAdmins = lazy(() => import('@/pages/platform/PlatformAdmins'));
const PlatformAuditLog = lazy(() => import('@/pages/platform/PlatformAuditLog'));
const PlatformCompanies = lazy(() => import('@/pages/platform/PlatformCompanies'));
const PlatformBootstrap = lazy(() => import('@/pages/platform/PlatformBootstrap'));
const MasterJobDetail = lazy(() => import('@/pages/platform/MasterJobDetail'));
const CreateMasterJob = lazy(() => import('@/pages/platform/CreateMasterJob'));
const NewMasterSopChooser = lazy(() => import('@/pages/platform/NewMasterSopChooser'));
const AiMasterSopBuilder = lazy(() => import('@/pages/platform/AiMasterSopBuilder'));

// Public authentication pages — lazy-loaded, rendered at the AuthenticatedApp
// shell level (before the seeding/company gate) so logged-out visitors can
// reach them without a company membership.
const Login = lazy(() => import('@/pages/Login'));
const Register = lazy(() => import('@/pages/Register'));
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, isAuthenticated } = useAuth();
  const location = useLocation();

  // Public, unauthenticated pages — surfaced for App Store review and direct links.
  // These render before the auth/seed gate so no account is required to view them.
  // /support is always public; the legal pages short-circuit only for logged-out
  // visitors so authenticated users keep their existing wrapped route below.
  if (location.pathname === '/support') return <Support />;
  if (authError?.type === 'auth_required' && (location.pathname === '/privacy-policy' || location.pathname === '/terms-of-service')) {
    const LegalPage = location.pathname === '/privacy-policy' ? PrivacyPolicy : TermsOfService;
    return <Suspense fallback={<RouteFallback />}><LegalPage /></Suspense>;
  }

  // Public authentication routes — reachable by logged-out visitors without a
  // company membership. Rendered before the seeding/company gate so existing
  // users can sign in directly: no plan selection, no workspace, no billing.
  //
  // Root cause of the registration 500: submitting /register while already
  // authenticated sends the existing session token with the register request,
  // which the auth backend rejects with HTTP 500. An authenticated user has no
  // reason to be on signup/login, so redirect them into the app. Password-reset
  // flows (URL-token-based, not session-based) stay accessible to all.
  if (['/login', '/register', '/forgot-password', '/reset-password'].includes(location.pathname)) {
    if (isLoadingPublicSettings || isLoadingAuth) return <RouteFallback />;
    if (isAuthenticated && (location.pathname === '/register' || location.pathname === '/login')) {
      return <Navigate to="/" replace />;
    }
    return (
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
        </Routes>
      </Suspense>
    );
  }

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
    <Suspense fallback={<RouteFallback />}>
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
      {/* Legal pages — accessible without the bottom nav wrapper.
          These standalone routes render outside Layout/PlatformLayout, so they
          are wrapped in the EXISTING PageTransition (opacity-only fade) to keep
          transitions consistent with the layout-managed routes. No second
          animation system is introduced. */}
      <Route path="/privacy-policy" element={<PageTransition><PrivacyPolicy /></PageTransition>} />
      <Route path="/terms-of-service" element={<PageTransition><TermsOfService /></PageTransition>} />
      <Route path="/admin/deletion-requests" element={<PageTransition><DeletionRequests /></PageTransition>} />
      <Route path="/subscription" element={<PageTransition><Subscription /></PageTransition>} />
      <Route path="/plans" element={<PageTransition><Plans /></PageTransition>} />
      <Route path="/team" element={<PageTransition><TeamMembers /></PageTransition>} />
      <Route path="/requests" element={<PageTransition><EditRequests /></PageTransition>} />
      <Route path="/activity" element={<PageTransition><ActivityHistory /></PageTransition>} />
      <Route path="/notifications" element={<PageTransition><Notifications /></PageTransition>} />
      <Route path="/accept-invitation" element={<PageTransition><AcceptInvitation /></PageTransition>} />
      <Route path="/company-profile" element={<PageTransition><CompanyProfile /></PageTransition>} />
      <Route path="/role-labels" element={<PageTransition><RoleLabels /></PageTransition>} />
      <Route path="/ownership" element={<PageTransition><OwnershipAndAccount /></PageTransition>} />
      <Route path="/sync-settings" element={<PageTransition><SyncSettings /></PageTransition>} />
      {/* Essential SOP Platform Admin — requires active PlatformMembership(SUPER_ADMIN) */}
      <Route path="/admin/master-library" element={<PlatformSuperAdminGuard><PageTransition><MasterLibrary /></PageTransition></PlatformSuperAdminGuard>} />
      <Route path="/admin/master-library/:masterId" element={<PlatformSuperAdminGuard><PageTransition><MasterSOPEditor /></PageTransition></PlatformSuperAdminGuard>} />
      {/* Platform Admin environment — /platform/* */}
      <Route path="/platform/bootstrap" element={<PageTransition><PlatformBootstrap /></PageTransition>} />
      <Route element={<PlatformGuard><PlatformLayout /></PlatformGuard>}>
        {/* /platform lands on Master Jobs — the God Mode front door */}
        <Route path="/platform" element={<Navigate to="/platform/master-library" replace />} />
        <Route path="/platform/master-library" element={<MasterLibrary />} />
        <Route path="/platform/master-library/new" element={<NewMasterSopChooser />} />
        <Route path="/platform/master-library/new-manual" element={<CreateMasterJob />} />
        <Route path="/platform/master-library/new-ai" element={<AiMasterSopBuilder />} />
        <Route path="/platform/master-library/:masterId" element={<MasterJobDetail />} />
        <Route path="/platform/master-library/:masterId/edit" element={<MasterSOPEditor />} />
        <Route path="/platform/companies" element={<PlatformCompanies />} />
        <Route path="/platform/admins" element={<PlatformAdmins />} />
        <Route path="/platform/audit" element={<PlatformAuditLog />} />
        <Route path="/platform/profile" element={<PlatformDashboard />} />
      </Route>
      <Route path="*" element={<PageTransition><PageNotFound /></PageTransition>} />
    </Routes>
    </Suspense>
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