import React from 'react';
import { useSafeBack } from '@/lib/useSafeBack';
import { ArrowLeft, AlertTriangle } from 'lucide-react';

/**
 * Terms of Service — structural legal terms for the Essential SOP application.
 * Attorney review recommended before final App Store submission.
 */
export default function TermsOfService() {
  const handleBack = useSafeBack('/profile');

  return (
    <div className="min-h-screen bg-app-bg" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="bg-app-surface border-b border-app-border sticky top-0 z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="px-4 py-3 flex items-center gap-3 max-w-2xl mx-auto">
          <button onClick={handleBack} className="icon-btn no-select touch-active" aria-label="Back">
            <ArrowLeft size={22} className="text-app-text-2" />
          </button>
          <h1 className="font-semibold text-app-text">Terms of Service</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 pb-16 selectable">


        {/* Draft / Review Status — business details require owner confirmation */}
        <div className="flex items-start gap-3 p-4 mb-6 bg-app-warning-bg border border-app-warning rounded-xl">
          <AlertTriangle size={18} className="text-app-warning flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-app-warning">Draft — Pending Owner Confirmation</p>
            <p className="text-xs text-app-text-2 mt-0.5">
              Structural legal terms. The following business details are working drafts requiring
              owner confirmation and attorney review before public release: legal contracting
              entity, support contact email, governing jurisdiction, and effective date.
            </p>
          </div>
        </div>

        <p className="text-xs text-app-text-muted mb-6">Last updated: October 22, 2026</p>

        <Section title="1. Acceptance of Terms">
          <p>
            By accessing or using the Essential SOP application ("App") operated by Essential SOP
            ("Company," "we," "our," or "us"), you agree to be bound by these Terms of Service
            ("Terms"). If you do not agree, do not use the App.
          </p>
          
        </Section>

        <Section title="2. Eligibility">
          <p>
            You must be at least 18 years old and have the authority to enter into a binding
            agreement to use this App. Use of the App is limited to authorized employees or
            contractors of Essential SOP or its clients.
          </p>
        </Section>

        <Section title="3. License to Use">
          <p>
            Subject to these Terms, we grant you a limited, non-exclusive, non-transferable,
            revocable license to access and use the App solely for your internal business operations.
            You may not:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Copy, modify, or distribute the App or its content.</li>
            <li>Reverse engineer or attempt to extract source code.</li>
            <li>Use the App for any unlawful purpose.</li>
            <li>Share your account credentials with unauthorized individuals.</li>
          </ul>
        </Section>

        <Section title="4. User Accounts">
          <p>
            You are responsible for maintaining the confidentiality of your login credentials and
            for all activity that occurs under your account. Notify us immediately of any
            unauthorized access at support@essentialsop-job-flow.com.
          </p>
        </Section>

        <Section title="5. User-Generated Content">
          <p>
            You retain ownership of any content (photos, notes, measurements) you submit through
            the App. By submitting content, you grant Essential SOP a limited license to store
            and process that content solely to provide the App's services.
          </p>
          <p className="mt-2">
            You are solely responsible for ensuring that content you submit does not violate any
            third-party rights or applicable law.
          </p>
        </Section>

        <Section title="6. Prohibited Conduct">
          <p>You agree not to:</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>Use the App in any manner that could damage, disable, or impair its operation.</li>
            <li>Attempt to gain unauthorized access to any part of the App or its systems.</li>
            <li>Upload malware, viruses, or other harmful code.</li>
            <li>Use the App to harass, threaten, or harm others.</li>
          </ul>
        </Section>

        <Section title="7. Disclaimer of Warranties">
          <p>
            THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND,
            EITHER EXPRESS OR IMPLIED. TO THE FULLEST EXTENT PERMITTED BY LAW, Essential SOP
            DISCLAIMS ALL WARRANTIES INCLUDING, BUT NOT LIMITED TO, IMPLIED WARRANTIES OF
            MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
          </p>
          
        </Section>

        <Section title="8. Limitation of Liability">
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, Essential SOP SHALL NOT BE
            LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES
            ARISING FROM YOUR USE OF THE APP.
          </p>
          
        </Section>

        <Section title="9. Indemnification">
          <p>
            You agree to indemnify, defend, and hold harmless Essential SOP and its officers,
            directors, employees, and agents from any claims, damages, or expenses arising from
            your use of the App or violation of these Terms.
          </p>
        </Section>

        <Section title="10. Termination">
          <p>
            We reserve the right to suspend or terminate your access to the App at any time, with
            or without notice, for conduct that violates these Terms or is otherwise harmful to
            other users, us, or third parties.
          </p>
        </Section>

        <Section title="11. Governing Law">
          <p>
            These Terms shall be governed by and construed in accordance with the laws of
            the United States, without regard to its conflict of law provisions.
          </p>
          
        </Section>

        <Section title="12. Changes to Terms">
          <p>
            We may update these Terms at any time. We will notify you by updating the "Last updated"
            date. Your continued use of the App after changes constitutes acceptance of the
            revised Terms.
          </p>
        </Section>

        <Section title="13. Contact Us">
          <p>
            If you have questions about these Terms, contact us at:
          </p>
          <p className="mt-2 p-3 bg-app-elevated rounded-lg text-sm">
            Essential SOP<br />
            support@essentialsop-job-flow.com
          </p>
          
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