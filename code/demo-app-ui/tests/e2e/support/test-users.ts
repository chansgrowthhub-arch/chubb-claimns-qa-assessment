/**
 * Seeded users from docker/compose/keycloak/demo-app-realm.json.
 * Single source of truth for E2E credentials and storage-state locations.
 */
export interface TestUser {
  email: string;
  password: string;
  role: 'ADMIN' | 'CLAIMANT';
  storageStatePath: string;
  landingPath: string;
}

const AUTH_DIR = 'tests/e2e/.auth';

export const ADMIN: TestUser = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'admin@demo.com',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'Admin123!',
  role: 'ADMIN',
  storageStatePath: `${AUTH_DIR}/admin.json`,
  landingPath: '/admin/dashboard',
};

export const CLAIMANT: TestUser = {
  email: process.env.E2E_CLAIMANT_EMAIL ?? 'claimant@demo.com',
  password: process.env.E2E_CLAIMANT_PASSWORD ?? 'Claimant123!',
  role: 'CLAIMANT',
  storageStatePath: `${AUTH_DIR}/claimant.json`,
  landingPath: '/claims',
};
