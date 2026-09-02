import React from 'react';
import { Link } from 'react-router-dom';
import { Shield, Mail, LogIn } from 'lucide-react';
import { APP_SETTINGS } from '@/lib/appSettings';

/**
 * Public Privacy Policy page for Essential SOP.
 *
 * Accessible WITHOUT authentication — rendered before the auth/company gate
 * (same pattern as /support) so logged-out visitors at the public URL
 * (https://essentialsop-job-flow.com/privacy) can read it without signing in.
 * Must not depend on auth, company, or platform context, and must not expose
 * any private company or platform data.
 *
 * Page copy is the authorized legal text. Effective date is shown at the top.
 */
const EFFECTIVE_DATE = 'September 2, 2026';
const CONTACT_EMAIL = APP_SETTINGS.supportEmail || 'Support@essentialsop-job-flow.com';

export default function Privacy() {
  return (
    <div className="min-h-screen bg-app-bg flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <header
        className="bg-app-surface border-b border-app-border sticky top-0 z-40"
        style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
      >
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-app-accent flex items-center justify-center flex-shrink-0">
              <Shield size={18} className="text-app-accent-text" />
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold text-app-text leading-tight truncate">Essential SOP Privacy Policy</h1>
              <p className="text-xs text-app-text-muted leading-tight">Effective {EFFECTIVE_DATE}</p>
            </div>
          </div>
          <Link
            to="/login"
            className="text-sm font-medium text-app-accent flex items-center gap-1 no-select touch-active px-2 py-1.5 rounded-lg hover:bg-app-info-bg flex-shrink-0"
          >
            <LogIn size={15} /> Sign In
          </Link>
        </div>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-6 pb-16 selectable">
        <p className="text-sm text-app-text-2 leading-relaxed mb-6">
          This Privacy Policy explains how Essential SOP (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or
          &ldquo;us&rdquo;) collects, uses, shares, and safeguards your information when you use the
          Essential SOP application (the &ldquo;App&rdquo;). By using the App, you agree to the
          practices described here.
        </p>

        <Section title="1. Information We Collect">
          <p>We may collect and process the following categories of information:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1.5">
            <li><strong>Account information</strong> such as your name and email address when you register or sign in.</li>
            <li><strong>Company and workspace information</strong> you provide when setting up or joining a company workspace.</li>
            <li><strong>App usage and interaction data</strong>, such as the features you use and how you interact with the App.</li>
            <li><strong>User-entered SOP and job content</strong>, including the procedures, checklists, and notes you create or edit.</li>
            <li><strong>Support communications</strong> you send us when requesting help.</li>
            <li><strong>Device and technical information</strong> as needed for app operation, such as device type, operating system, and app version.</li>
          </ul>
        </Section>

        <Section title="2. How We Use Information">
          <p>We use the information we collect to:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1.5">
            <li>Provide and operate Essential SOP.</li>
            <li>Authenticate users and maintain account security.</li>
            <li>Manage company workspaces, team membership, and permissions.</li>
            <li>Deliver SOP and job content to the members of your workspace.</li>
            <li>Support AI-assisted search and responses in the Assistant feature.</li>
            <li>Improve reliability, security, and overall product performance.</li>
            <li>Provide customer support and respond to your requests.</li>
          </ul>
        </Section>

        <Section title="3. AI Features">
          <p>
            The App includes an AI-assistant feature. To provide Assistant functionality, your
            queries and relevant content from your workspace may be processed by AI services we use.
            That processing is subject to the applicable privacy and security practices of those
            service providers. We do not use AI features to make automated decisions about your
            employment or access without your involvement.
          </p>
        </Section>

        <Section title="4. Data Sharing">
          <p>We do <strong>not</strong> sell your personal information to advertisers.</p>
          <p className="mt-2">
            We may share information with our service providers only as needed to operate the App,
            including for hosting, authentication, AI functionality, analytics, security, billing,
            and customer support. These providers are bound by confidentiality and may only use your
            information to provide services on our behalf. We may also disclose information when
            required by law or to protect rights, safety, or property.
          </p>
        </Section>

        <Section title="5. Data Security">
          <p>
            We implement reasonable administrative, technical, and organizational safeguards designed
            to protect your information against unauthorized access, alteration, disclosure, or
            destruction. These include access controls, encryption in transit, and regular security
            reviews. However, no method of transmission over the Internet or electronic storage is
            completely secure, so we cannot guarantee absolute security.
          </p>
        </Section>

        <Section title="6. Data Retention">
          <p>
            We retain your information for as long as your account is active and as needed to provide
            the service, meet legal obligations, resolve disputes, and enforce our agreements. When
            you request account deletion, we remove or anonymize your information in accordance with
            our retention schedule, except where we are required to retain it for legal or security
            purposes.
          </p>
        </Section>

        <Section title="7. User Choices and Rights">
          <p>You may request access to, correction of, or deletion of your account information by:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1.5">
            <li>Using the account and deletion controls within the App&rsquo;s Profile settings.</li>
            <li>Emailing us at the contact address below.</li>
          </ul>
          <p className="mt-2">
            Depending on your jurisdiction, you may have additional rights regarding your personal
            data. We will respond to verifiable requests within a reasonable timeframe.
          </p>
        </Section>

        <Section title="8. Children">
          <p>
            Essential SOP is not intended for children under 13 years of age, and we do not knowingly
            collect personal information from children under 13. If a different minimum age is required
            by applicable law in your jurisdiction, that age applies instead. If you believe a child
            has provided us with personal information, please contact us so we can delete it.
          </p>
        </Section>

        <Section title="9. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. When we do, we will revise the
            &ldquo;Effective&rdquo; date shown at the top of this page. We encourage you to review this
            policy periodically. Your continued use of the App after a change indicates your
            acceptance of the updated policy.
          </p>
        </Section>

        <Section title="10. Contact">
          <p>If you have questions about this Privacy Policy or your personal information, contact us at:</p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2.5 bg-app-accent text-app-accent-text rounded-xl text-sm font-semibold no-select touch-active"
          >
            <Mail size={16} /> {CONTACT_EMAIL}
          </a>
        </Section>

        <Section title="11. Effective Date">
          <p>This Privacy Policy is effective as of {EFFECTIVE_DATE}.</p>
        </Section>
      </main>

      {/* Footer */}
      <footer
        className="border-t border-app-border bg-app-surface"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="max-w-2xl mx-auto px-4 py-6 text-center">
          <p className="text-sm font-semibold text-app-text">Essential SOP</p>
          <p className="text-xs text-app-text-muted mt-1">&copy; 2026 Jordan Levasseur</p>
        </div>
      </footer>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mb-7">
      <h2 className="text-base font-bold text-app-text mb-2">{title}</h2>
      <div className="text-sm text-app-text-2 leading-relaxed space-y-1">{children}</div>
    </section>
  );
}