import React from 'react';
import { Link } from 'react-router-dom';
import {
  LifeBuoy, Mail, KeyRound, CreditCard, Wrench, Bug, Lightbulb, Building2,
  HelpCircle, Wifi, RefreshCw, LogIn, Download, FileText, Shield, ChevronRight,
} from 'lucide-react';
import { APP_SETTINGS } from '@/lib/appSettings';

/**
 * Public Support page for Essential SOP.
 *
 * Accessible WITHOUT authentication — used as the official Apple App Store
 * Support URL. Renders outside the authenticated app shell, so it must not
 * depend on auth, company, or platform context, and must not expose any
 * admin tools or internal company data.
 *
 * To enable the contact email, set APP_SETTINGS.supportEmail in
 * src/lib/appSettings.js. Until then a graceful placeholder is shown.
 */
const SUPPORT_TOPICS = [
  { icon: HelpCircle, title: 'General App Support', body: 'Questions about how Essential SOP works, navigation, and core features.' },
  { icon: KeyRound, title: 'Login & Account Access', body: 'Trouble signing in, password resets, or accessing your account.' },
  { icon: CreditCard, title: 'Subscription & Billing', body: 'Plan questions, charges, receipts, and subscription status.' },
  { icon: Wrench, title: 'Technical Issues', body: 'Crashes, errors, sync problems, or unexpected behavior.' },
  { icon: Bug, title: 'Bug Reports', body: 'Something not working as expected? Let us know what happened.' },
  { icon: Lightbulb, title: 'Feature Requests', body: 'Ideas to improve Essential SOP for your team and trade.' },
  { icon: Building2, title: 'Company Account Questions', body: 'Company setup, team membership, roles, and workspace access.' },
];

const TROUBLESHOOTING = [
  { icon: Wifi, text: 'Make sure you have a stable internet connection.' },
  { icon: RefreshCw, text: 'Close and reopen the app.' },
  { icon: LogIn, text: 'Sign out and sign back in.' },
  { icon: Download, text: 'Make sure the app is updated to the latest version.' },
  { icon: Mail, text: 'If the problem continues, contact support and include what device you are using and a description of the issue.' },
];

export default function Support() {
  const email = APP_SETTINGS.supportEmail;

  return (
    <div className="min-h-screen bg-app-bg flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <header className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}>
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-app-accent flex items-center justify-center flex-shrink-0">
              <LifeBuoy size={18} className="text-app-accent-text" />
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold text-app-text leading-tight truncate">Essential SOP Support</h1>
              <p className="text-xs text-app-text-muted leading-tight">We're here to help</p>
            </div>
          </div>
          <Link
            to="/"
            className="text-sm font-medium text-app-accent flex items-center gap-1 no-select touch-active px-2 py-1.5 rounded-lg hover:bg-app-info-bg flex-shrink-0"
          >
            Sign In
          </Link>
        </div>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-6 pb-20">
        {/* Intro */}
        <section className="mb-6">
          <h2 className="text-xl font-bold text-app-text mb-1.5">Need help with Essential SOP?</h2>
          <p className="text-sm text-app-text-2 leading-relaxed">We're here to help. Use the resources below to get answers, troubleshoot, or reach our support team.</p>
        </section>

        {/* Contact — prominent */}
        <section className="mb-8">
          <div className="rounded-2xl border border-app-accent/30 bg-app-info-bg p-5">
            <div className="flex items-center gap-2 mb-1.5">
              <Mail size={18} className="text-app-accent" />
              <h3 className="text-sm font-semibold text-app-text">Contact Support</h3>
            </div>
            {email ? (
              <>
                <p className="text-sm text-app-text-2 mb-3">Email us and we'll get back to you as soon as possible.</p>
                <a
                  href={`mailto:${email}`}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold no-select touch-active"
                >
                  <Mail size={16} /> {email}
                </a>
              </>
            ) : (
              <p className="text-sm text-app-text-2">
                Support email is being configured. Please check back shortly, or contact us through your company administrator.
              </p>
            )}
          </div>
        </section>

        {/* How we can help */}
        <section className="mb-8">
          <h3 className="text-sm font-semibold text-app-text-muted uppercase tracking-wide mb-3">How We Can Help</h3>
          <div className="space-y-2.5">
            {SUPPORT_TOPICS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex items-start gap-3 p-4 bg-app-card border border-app-border rounded-xl">
                <div className="w-9 h-9 rounded-lg bg-app-elevated flex items-center justify-center flex-shrink-0">
                  <Icon size={18} className="text-app-accent" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-app-text">{title}</p>
                  <p className="text-xs text-app-text-2 mt-0.5 leading-relaxed">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Troubleshooting */}
        <section className="mb-8">
          <h3 className="text-sm font-semibold text-app-text-muted uppercase tracking-wide mb-3">Try These First</h3>
          <div className="bg-app-card border border-app-border rounded-xl divide-y divide-app-divider overflow-hidden">
            {TROUBLESHOOTING.map(({ icon: Icon, text }, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3.5">
                <Icon size={18} className="text-app-text-2 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-app-text-2 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Legal links */}
        <section className="mb-10">
          <h3 className="text-sm font-semibold text-app-text-muted uppercase tracking-wide mb-3">Legal</h3>
          <div className="bg-app-card border border-app-border rounded-xl overflow-hidden">
            <Link to="/privacy-policy" className="flex items-center gap-3 px-4 py-3.5 no-select touch-active hover:bg-app-elevated">
              <Shield size={18} className="text-app-text-2 flex-shrink-0" />
              <span className="text-sm text-app-text flex-1">Privacy Policy</span>
              <ChevronRight size={18} className="text-app-text-muted flex-shrink-0" />
            </Link>
            <div className="h-px bg-app-divider" />
            <Link to="/terms-of-service" className="flex items-center gap-3 px-4 py-3.5 no-select touch-active hover:bg-app-elevated">
              <FileText size={18} className="text-app-text-2 flex-shrink-0" />
              <span className="text-sm text-app-text flex-1">Terms of Service</span>
              <ChevronRight size={18} className="text-app-text-muted flex-shrink-0" />
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-app-border bg-app-surface" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="max-w-2xl mx-auto px-4 py-6 text-center">
          <p className="text-sm font-semibold text-app-text">Essential SOP</p>
          <p className="text-xs text-app-text-muted mt-1">© 2026 Essential SOP</p>
        </div>
      </footer>
    </div>
  );
}