import React from 'react';
import Onboarding from '@/pages/Onboarding';

/**
 * Shown when a user has no active company memberships.
 * Delegates entirely to the Onboarding plan-selection flow.
 */
export default function NoCompanyScreen() {
  return <Onboarding />;
}