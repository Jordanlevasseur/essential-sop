/**
 * App-level configurable settings.
 *
 * To connect external hosted legal pages or support links, set the corresponding
 * URL fields here. Leave a field as an empty string to fall back to the in-app
 * placeholder page.
 *
 * ⚠️  These values are baked into the client bundle. Do not store secrets here.
 */
export const APP_SETTINGS = {
  /** Hosted Privacy Policy URL. If empty, the in-app placeholder page is shown. */
  privacyPolicyUrl: '',

  /** Hosted Terms of Service URL. If empty, the in-app placeholder page is shown. */
  termsOfServiceUrl: '',

  /** Support portal URL shown in Profile. */
  supportUrl: '',

  /** Support email address shown in Profile. */
  supportEmail: '',
};

/**
 * Open a legal page:
 *  - If a hosted URL is configured, open it in a new tab / in-app browser.
 *  - Otherwise return the in-app route so the caller can navigate() to it.
 *
 * Returns { external: true } if the URL was opened externally,
 * or { external: false, route: string } if the caller should navigate internally.
 */
export function resolveLegalLink(urlKey, inAppRoute) {
  const url = APP_SETTINGS[urlKey];
  if (url) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return { external: true };
  }
  return { external: false, route: inAppRoute };
}