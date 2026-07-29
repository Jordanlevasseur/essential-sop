import React from "react";
import AuthLegalFooter from "@/components/AuthLegalFooter";

/**
 * Shared shell for all authentication screens.
 * AuthLegalFooter is always rendered below the card — every auth page inherits
 * it automatically. Individual pages use the `footer` prop for nav links
 * (e.g. "Already have an account? Log in") which appear between the card and
 * the legal footer.
 */
export default function AuthLayout({ icon: Icon, title, subtitle, footer, children }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-8"
      style={{ paddingTop: 'max(env(safe-area-inset-top), 32px)' }}
    >
      <div className="w-full max-w-md flex flex-col">
        {/* Branding header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4">
            <Icon className="w-7 h-7 text-primary-foreground" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-2">{subtitle}</p>}
        </div>

        {/* Card */}
        <div className="bg-card rounded-2xl shadow-sm border border-border p-8">
          {children}
        </div>

        {/* Per-page nav footer (e.g. "Already have an account?") */}
        {footer && (
          <p className="text-center text-sm text-muted-foreground mt-6">{footer}</p>
        )}

        {/* Legal footer — always present on every auth screen */}
        <AuthLegalFooter />
      </div>
    </div>
  );
}