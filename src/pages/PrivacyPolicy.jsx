import React from 'react';
import { useSafeBack } from '@/lib/useSafeBack';
import { ArrowLeft, AlertTriangle } from 'lucide-react';

/**
 * ⚠️  PLACEHOLDER — requires final legal review before App Store submission.
 * Replace this content with your attorney-approved Privacy Policy text, or configure
 * APP_SETTINGS.privacyPolicyUrl in src/lib/appSettings.js to point to a hosted version.
 */
export default function PrivacyPolicy() {
  const handleBack = useSafeBack('/profile');

  return (
    <div className="min-h-screen bg-app-bg" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-4 py-3 flex items-center gap-3 max-w-2xl mx-auto">
          <button onClick={handleBack} className="icon-btn no-select touch-active" aria-label="Back">
            <ArrowLeft size={22} className="text-app-text-2" />
          </button>
          <h1 className="font-semibold text-app-text">Privacy Policy</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 pb-16 selectable">
        {/* Draft warning */}
        <div className="flex items-start gap-3 p-4 mb-6 bg-app-warning-bg border border-app-warning rounded-xl">
          <AlertTriangle size={18} className="text-app-warning flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-app-warning">Placeholder — Not Legally Approved</p>
            <p className="text-xs text-app-text-2 mt-0.5">
              This is a structural placeholder only. It must be replaced with attorney-reviewed
              legal text before publishing to any app store or distribution channel.
            </p>
          </div>
        </div>

        <p className="text-xs text-app-text-muted mb-6">Last updated: [DATE REQUIRED]</p>

        <Section title="1. Introduction">
          <p>
            [COMPANY NAME] ("we," "our," or "us") operates the Essential SOP mobile application
            (the "App"). This Privacy Policy explains how we collect, use, disclose, and safeguard
            your information when you use the App.
          </p>
          <p className="mt-2">
            <strong>Please read this policy carefully.</strong> If you do not agree with its terms,
            please do not access the App. This section requires final legal review before publication.
          </p>
        </Section>

        <Section title="2. Information We Collect">
          <p>We may collect the following categories of information:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><strong>Account Information:</strong> Name, email address, and role when you register.</li>
            <li><strong>Usage Data:</strong> Pages viewed, features used, and interaction timestamps.</li>
            <li><strong>Device Information:</strong> Device type, operating system, and app version.</li>
            <li><strong>User-Generated Content:</strong> Job notes, photos, and checklist responses you submit.</li>
          </ul>
          <p className="mt-2 text-app-text-muted text-sm">[Confirm exact data collected with your engineering team and legal counsel before publishing.]</p>
        </Section>

        <Section title="3. How We Use Your Information">
          <p>We use collected information to:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Provide, operate, and maintain the App.</li>
            <li>Authenticate users and manage accounts.</li>
            <li>Improve and personalize the App experience.</li>
            <li>Communicate service updates and respond to support requests.</li>
            <li>Comply with legal obligations.</li>
          </ul>
        </Section>

        <Section title="4. Sharing of Information">
          <p>
            We do not sell your personal information. We may share information with:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><strong>Service Providers:</strong> Third-party vendors who assist in operating the App under confidentiality agreements.</li>
            <li><strong>Legal Compliance:</strong> When required by law, court order, or governmental authority.</li>
            <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets.</li>
          </ul>
          <p className="mt-2 text-app-text-muted text-sm">[List specific third-party processors here after legal review.]</p>
        </Section>

        <Section title="5. Data Retention & Account Deletion">
          <p>
            You may request deletion of your account at any time via Profile → Ownership & Account →
            Account & Data → Delete My Account. Any authenticated user — including the sole owner
            of a single-person workspace — can submit a request. When you submit it, your session is
            revoked immediately and the request is placed in a Pending state for administrator review.
            Account deletion is generally completed within 30 days of your request.
          </p>
          <p className="mt-2"><strong>Company workspace deletion:</strong> a General Manager may request permanent deletion of the
          entire company workspace via Profile → Ownership & Account → Account & Data → Request Company
          Deletion. The request requires typing the company name to confirm, is reviewed by Essential SOP
          administration, and the workspace and all its data remain unchanged until approved and processed.
          Only a Platform Super Administrator can approve and execute the deletion. Company deletion does not
          delete employees' individual Essential SOP accounts or their access to unrelated companies.</p>
          <p className="mt-2"><strong>Workspaces:</strong> if you are the sole owner and only active member of a workspace (for example, a one-profile Homeowner workspace), the workspace is <strong>closed</strong> as part of your deletion — it is not deleted, and its standard operating procedures and records are retained. If you are the sole owner of a workspace that still has other active members, ownership must be transferred before your account can be deleted, so the workspace is not left without an owner.</p>
          <p className="mt-2">When an administrator completes your request, Essential SOP:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li><strong>Deletes</strong> your personal in-app notifications.</li>
            <li><strong>Revokes</strong> your company and platform memberships (access is removed; the membership records are retained for roster and audit history).</li>
            <li><strong>Cancels</strong> any pending invitations sent to your email address.</li>
            <li><strong>Closes</strong> any single-person workspace you owned (status set to closed; data retained).</li>
            <li><strong>Removes</strong> your login (authentication) identity as a manual administrator step.</li>
          </ul>
          <p className="mt-2"><strong>Retained company operational records:</strong> standard operating procedures, job templates, section content, job overrides and revisions, edit requests (including the requester's reason and supporting note as part of the company's SOP-governance record), uploaded reference documents and PDFs, version-analysis/decision/deferral records, temporary edit grants, activity logs, platform audit logs, and distribution/provisioning records. These reference your account by ID or name as part of legitimate company audit and governance history; they are shared operational data, not your personal data, and are <strong>not</strong> deleted with your account.</p>
          <p className="mt-2"><strong>Completion confirmation:</strong> we attempt to send a confirmation email to your registered address. If delivery cannot be confirmed (for example, because your login identity has already been removed or email delivery is unavailable), an administrator will inform you through an alternative verified channel and record that notification. You will not be able to sign in again after deletion.</p>
          <p className="mt-2 text-app-text-muted text-sm">[Finalize retention periods with legal counsel before publishing.]</p>
        </Section>

        <Section title="6. Security">
          <p>
            We implement reasonable technical and organizational measures to protect your information.
            However, no transmission over the Internet or electronic storage is 100% secure.
          </p>
        </Section>

        <Section title="7. Your Rights">
          <p>Depending on your jurisdiction, you may have rights to:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Access the personal data we hold about you.</li>
            <li>Request correction or deletion of your data.</li>
            <li>Object to or restrict certain processing.</li>
            <li>Data portability.</li>
          </ul>
          <p className="mt-2 text-app-text-muted text-sm">[Confirm applicable rights based on your users' jurisdictions — e.g., GDPR, CCPA — with legal counsel.]</p>
        </Section>

        <Section title="8. Children's Privacy">
          <p>
            The App is not directed to children under the age of 13. We do not knowingly collect
            personal information from children under 13.
          </p>
        </Section>

        <Section title="9. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any changes
            by updating the "Last updated" date. Continued use of the App after changes constitutes
            acceptance of the revised policy.
          </p>
        </Section>

        <Section title="10. Contact Us">
          <p>
            If you have questions about this Privacy Policy, please contact us at:
          </p>
          <p className="mt-2 p-3 bg-app-elevated rounded-lg text-sm">
            [COMPANY NAME]<br />
            [ADDRESS]<br />
            [EMAIL ADDRESS]<br />
            [PHONE NUMBER]
          </p>
          <p className="mt-2 text-app-text-muted text-sm">[Replace all bracketed placeholders before publication.]</p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-6">
      <h2 className="text-xl font-semibold text-app-heading mb-2">{title}</h2>
      <div className="text-sm text-app-text-2 leading-relaxed space-y-1">{children}</div>
    </div>
  );
}