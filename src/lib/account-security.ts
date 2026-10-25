export type AccountSecurity = {
  checking: boolean;
  email: string;
  pendingEmail: string;
  emailConfirmed: boolean;
  hasPassword: boolean | null;
  error: string;
};
export const initialSecurity: AccountSecurity = { checking: true, email: '', pendingEmail: '', emailConfirmed: false, hasPassword: null, error: '' };
export function securityStage(account: AccountSecurity, fallbackPassword = false) {
  if (account.hasPassword === null && fallbackPassword) return 'secured';
  if (account.error && account.hasPassword === null) return 'unavailable';
  if (account.checking && account.hasPassword === null) return 'checking';
  if (account.pendingEmail && !account.emailConfirmed) return 'confirm-email';
  if ((account.hasPassword ?? fallbackPassword) && account.emailConfirmed) return 'secured';
  if (account.email && !account.emailConfirmed) return 'confirm-email';
  if (account.emailConfirmed) return 'set-password';
  return 'start';
}
