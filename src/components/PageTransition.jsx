/**
 * PageTransition — subtle, non-blocking fade-in on route change.
 *
 * Animates OPACITY ONLY. We deliberately avoid translate/scale transforms because
 * a transform on an ancestor creates a containing block that breaks `position:
 * fixed` children rendered inside a page (dialogs, bottom sheets, publish
 * confirmation modals, the account-deletion modal). Animating opacity preserves
 * fixed positioning so every overlay remains anchored to the viewport.
 *
 * Fast (150ms), non-blocking, and preserves browser/history navigation semantics.
 */
import React from 'react';
import { useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function PageTransition({ children }) {
  const location = useLocation();
  return (
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}