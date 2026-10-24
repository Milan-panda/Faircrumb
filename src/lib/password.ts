import type { SupabaseClient } from '@supabase/supabase-js';

const confirmationMessage = 'Confirm your email using the link Supabase sent, then return here and save your password again. Keep this browser signed in. If no email arrives, check spam and the project’s SMTP configuration.';

export class EmailConfirmationRequired extends Error {}

export class AuthEmailRateLimited extends Error {}
function checkAuthError(error: { message: string; code?: string } | null) {
  if (!error) return;
  if (error.code === 'over_email_send_rate_limit' || /email rate limit exceeded/i.test(error.message)) {
    throw new AuthEmailRateLimited('Supabase’s authentication email limit has been reached. Use an existing confirmation email if one arrived. Otherwise, wait for your project’s quota to reset or configure custom SMTP in Supabase Authentication. Repeated saves cannot bypass this limit. Keep this browser signed in until password setup succeeds.');
  }
  throw error;
}


export async function setAccountPassword(auth: SupabaseClient['auth'], username: string, password: string, recoveryEmail?: string) {
  const normalized = username.trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9_]{3,24}$/.test(normalized)) throw new Error('Your profile has an invalid username. Reload your profile before setting a password.');
  if (password.length < 12) throw new Error('Use a password with at least 12 characters.');
  const requestedEmail = recoveryEmail?.trim().toLowerCase();
  if (requestedEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedEmail) || requestedEmail.endsWith('.internal'))) throw new Error('Enter a real email address you can access.');
  const { data, error } = await auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Your session expired. Keep this page open and reconnect before setting a password.');
  const owner = data.user.id;
  let user = data.user;
  const email = requestedEmail || user.email;
  if (!email) throw new Error('Enter an email address to secure this account.');

  if (!user.email) {
    if (user.new_email === email) throw new EmailConfirmationRequired(confirmationMessage);
    // Supabase creates a password identity before processing an email change when
    // both fields are sent together. Anonymous users must link their email first.
    const linked = await auth.updateUser({ email }, typeof window === 'undefined' ? undefined : { emailRedirectTo: window.location.origin });
    checkAuthError(linked.error);
    const verified = await auth.getUser();
    if (verified.error) throw verified.error;
    if (!verified.data.user || verified.data.user.id !== owner) throw new Error('The signed-in account changed. Retry password setup in the original account.');
    user = verified.data.user;
  }

  if (user.email !== email) {
    if (user.is_anonymous || !user.email) throw new EmailConfirmationRequired(confirmationMessage);
    throw new Error('This account has a different sign-in email. Use its existing email to update the password; changing a linked email is a separate action.');
  }
  if (!user.email_confirmed_at || user.is_anonymous) throw new EmailConfirmationRequired(confirmationMessage);
  const result = await auth.updateUser({ password });
  checkAuthError(result.error);
  if (!result.data.user || result.data.user.id !== owner) throw new Error('Password setup could not be verified. Keep your current session open and retry.');
  return result.data.user;
}
