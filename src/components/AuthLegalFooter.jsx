import React from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveLegalLink } from '@/lib/appSettings';

/**
 * Shared legal footer for all authentication screens.
 * Rendered automatically by AuthLayout — do not duplicate in individual pages.
 *
 * Touch targets: each link is wrapped in a <button> with min 44×44 px via the
 * .icon-btn class (defined in index.css) to meet Apple HIG / WCAG 2.5.5.
 * Safe-area: the parent AuthLayout scrollable container handles bottom inset.
 */
export default function AuthLegalFooter() {
  const navigate = useNavigate();

  const openPrivacy = () => {
    const r = resolveLegalLink('privacyPolicyUrl', '/privacy-policy');
    if (!r.external) navigate(r.route);
  };

  const openTerms = () => {
    const r = resolveLegalLink('termsOfServiceUrl', '/terms-of-service');
    if (!r.external) navigate(r.route);
  };

  return (
    <p className="text-center text-xs text-muted-foreground leading-relaxed px-4 mt-6"
       style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}>
      By continuing, you agree to the{' '}
      <button
        type="button"
        onClick={openTerms}
        aria-label="Open Terms of Service"
        className="
          inline-flex items-center justify-center
          min-h-[44px] min-w-[44px] -my-3 px-1
          text-xs font-medium text-primary underline underline-offset-2
          hover:text-primary/80
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded
          transition-opacity active:opacity-60
        "
      >
        Terms of Service
      </button>
      {' '}and acknowledge the{' '}
      <button
        type="button"
        onClick={openPrivacy}
        aria-label="Open Privacy Policy"
        className="
          inline-flex items-center justify-center
          min-h-[44px] min-w-[44px] -my-3 px-1
          text-xs font-medium text-primary underline underline-offset-2
          hover:text-primary/80
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded
          transition-opacity active:opacity-60
        "
      >
        Privacy Policy
      </button>
      .
    </p>
  );
}