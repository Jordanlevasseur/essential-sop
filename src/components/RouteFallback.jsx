/**
 * RouteFallback — Suspense fallback for lazy-loaded route chunks.
 *
 * Used by the top-level <Suspense> in App.jsx and the inner <Suspense>
 * boundaries at the Layout / PlatformLayout Outlets.
 *
 * Design constraints:
 *  - Uses app design tokens (bg-app-bg / app-border / app-accent) so it
 *    renders correctly in both light and dark mode and never flashes white.
 *  - Respects the device safe-area (notch) at the top.
 *  - Is a normal-flow (non-fixed) element, so when it renders inside a Layout
 *    Outlet it never paints over the fixed bottom navigation (z-40).
 *  - Lightweight: a single spinner, no heavy dependencies.
 */
export default function RouteFallback() {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-app-bg"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
    </div>
  );
}