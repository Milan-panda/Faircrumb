# faircrumb

A responsive, installable expense-sharing PWA built from `faircrumb_architecture_blueprint.md`. React + TypeScript + Vite on the frontend; Supabase Auth, Postgres, Storage and Realtime on the backend. All amounts use integer paise; the first version supports INR.

## Run locally

Requires Node 22.12 or later.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open the URL printed by Vite. Without Supabase credentials, select **Explore the demo**. Demo edits persist only in this browser and never upload to Supabase. To preview install/offline behavior, use `pnpm build && pnpm preview`; service workers require HTTPS outside localhost.

## Connect Supabase

1. Create a Supabase project. Run all SQL files in `supabase/migrations/` in filename order, each once in its SQL Editor (or apply them with the Supabase CLI). If earlier migrations are already applied, run only the newer unapplied files; the latest is `202610250001_admin_recovery.sql`.
2. Enable **Anonymous Sign-Ins**, **Manual linking**, and email/password Auth. New password setup uses a real user-provided email. Email confirmation can stay enabled: configure the correct Site URL / redirect allowlist and a working SMTP provider, then users confirm the email before finishing password setup. Configure a minimum password length of 12. Set Auth rate limits and abuse protection appropriate to your deployment.
3. Copy the project URL and **publishable key** into `.env.local` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Never put a service-role or secret key in a `VITE_` variable.
4. Restart Vite. Create a profile with a name and unique username. Create a group, then add another existing username or create a ghost profile. Share the generated claim token privately with that person; it is shown only once.
5. In Settings, enter your **Sign-in email** and password. If confirmation is enabled, open the confirmation link, return to the app, and save the password again. Keep the current session until setup finishes. Sign in on other devices using **email + password**; your username and group/profile IDs remain unchanged. Legacy accounts already linked to `<username>@splitfree.internal` can still sign in with their username. New setups never generate a synthetic email.

The migration enables RLS, denies direct mutations, generates audit history on the server, canonicalizes member identities, checks that all split totals balance, and checks revisions on every group write. Only group members can read group ledgers. Claims are hashed in a private schema, which is not exposed to browser clients.

## Deploy to Vercel

The included `vercel.json` configures Vite, dependency installation, the full production build (including the service worker), `dist` output, navigation fallback and service-worker revalidation.

1. Complete **Connect Supabase** above, including both migrations and Auth settings.
2. From this project directory, run `npx vercel@latest login`, then `npx vercel@latest`. Follow the prompts to create/link a Vercel project. The initial preview can run in demo mode until environment variables are configured. A Git repository is not required for CLI deployment.
3. In that project's Vercel dashboard, open **Settings → Environment Variables**. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for Production and Preview. Use the Supabase project's public publishable key, never a secret/service-role key. These values are compiled into the browser bundle.
4. Run `npx vercel@latest --prod` from this directory. Environment-variable changes require a new deployment; they do not change an existing bundle.
5. Set the resulting production HTTPS URL as the Supabase Authentication Site URL. If you later add a custom domain, update it to that domain.
6. Verify on the live URL: create a profile, set a password, sign in on a second device, create a group and expense, upload a receipt, and check changes appear on the other device. Install the PWA on a supported device and reopen it offline after an online visit.

For automatic deployment on future pushes, put this folder in a Git repository and connect it through Vercel's **Add New → Project** flow. Use framework **Vite**, build command `npm run build`, output directory `dist`, and Node **22.x** (22.12 or later). Add the same environment variables before deploying.

## Implemented

- Responsive dashboard, groups and member profiles, username onboarding and password login.
- Persistent System/Light/Dark appearance, pre-render theme resolution, subtle theme dissolve, native dialog motion and reduced-motion support.
- Shared default splits per group, recoverable expense drafts, partial-payment review, participant-only payment undo and deleted-expense restoration.
- Ghost creation with private claim tokens; local demo with sample groups.
- Equal, exact, percentage, shares and itemized proportional extras/discount splits; multiple payers and selectable participants.
- Add/edit/delete expenses, server-generated edit and deletion audit history.
- Per-group debt simplification, manual settlement records, UPI deep links when a payee has a UPI ID.
- Instant expense search, category filters, friend balances and activity feed.
- Consumption, cash-flow and group analytics; category donut, daily bars, member comparison and six-month trend.
- CSV export, JSON backup, and browser Print / Save as PDF.
- Private receipt uploads (JPG/PNG/WebP/PDF, up to 5 MB) with group-scoped Storage policies and signed viewing links.
- Web manifest, install support, cached app shell, offline ledger persistence and queued group writes.
- Revision conflict detection; export local data before explicitly discarding local changes to reload cloud data.

## Validation

```bash
pnpm test
pnpm test:db
pnpm build
pnpm test:pwa
pnpm dlx react-doctor@latest . --verbose
```

See `DEVELOPMENT_LOG.md` for commands, decisions, actual validation results and outstanding setup. `docs/PRODUCT_REVIEW.md` records the competitor/research audit and implemented improvements.

Appearance is available from the sun/moon button on onboarding and in the app header. Settings → Appearance offers System, Light and Dark. Reduced motion is respected; browsers without View Transitions use an in-place color dissolve. Drafts and theme preferences are saved on the current device; drafts are not uploaded until you save an expense. Group → Split defaults sets future split ratios. Activity → Restore expense recovers the latest deleted version.

## Boundaries and next steps

- This implementation stores one validated JSON document per group rather than the blueprint's normalized tables. It is suited to small friend groups; a group, including audit history, is capped at 1 MB, with up to 100 members. Migrate to normalized expenses/splits and an append-only operation queue for larger ledgers.
- Concurrent changes to the same group cause a visible conflict; they do not silently merge. Offline sync runs while the app is open. JSON backups are readable exports; importing/merging them is not implemented.
- Receipt OCR, recurring expenses, system push notifications, multi-currency conversion, cross-group netting and account deletion are not included. Existing friends are added by username. UPI links initiate external payments; faircrumb cannot verify payment completion.
- CSV rows contain paid and owed shares. Printed reports use the browser's PDF destination, not a dedicated PDF renderer. The service worker only caches the app shell; it never intercepts Supabase API requests. Receipts require connectivity and are not included as binary files in JSON backups.
- Passwords are managed by Supabase Auth. The browser retains auth sessions and local ledger data; use your own device and protect it. Signing out retains the per-profile cache so pending data can be recovered on that device.
- Local verification used existing installed package copies through ignored symlinks because this session could not access the package registry. On another machine run `pnpm install` normally. No lockfile was generated; the validated direct dependency versions are listed in `DEVELOPMENT_LOG.md`.
- A hosted Supabase project and HTTPS hosting must be configured before real multi-user or installed-device verification. No project credentials or deployment target were supplied, so nothing has been deployed or remotely provisioned.

## Authentication email limits

If password setup reports **email rate limit exceeded**, the Supabase project has exhausted an Auth email-sending allowance. This cannot be reset in the frontend. Check for a previously sent confirmation email and use its link without requesting another. If none arrived, wait for the server quota to reset or configure custom SMTP under Supabase Authentication, then review its Rate Limits settings. Keep the current anonymous session until setup succeeds.

Supabase documents a built-in allowance of 2 Auth emails per hour per project, with built-in delivery restricted to organization team addresses. Custom SMTP is needed for normal user delivery; provider limits still apply. See [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits) and [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp). Configure the correct Site URL and redirect allowlist as well. The app neither retries Auth email requests automatically nor resends while Supabase reports a pending email change.

## Install on a phone

A mobile install card appears on the welcome screen and in the app. The header's **Install** button stays available if you dismiss the card; Settings also includes an install action. Supported browsers open their native install prompt. On iPhone/iPad the app shows Safari Share → Add to Home Screen instructions, including Open as Web App where offered. In-app browsers should open the page in a regular browser first.

The promotion hides in standalone/installed mode. A browser install prompt is single-use, is opened only by a user action, and is not replayed after dismissal. Native installation depends on the browser and serving the production site over HTTPS (localhost is the development exception). `pnpm dev` on a plain HTTP LAN IP will not necessarily offer native PWA installation; use an HTTPS deployment to test from a phone. Confirm your account email/password before switching browser contexts if you already have anonymous-account data to preserve.

## Rebrand compatibility

The product is now **faircrumb**. Existing browser-storage keys, Supabase migration filenames and legacy synthetic login addresses retain their original namespace intentionally, so existing sessions, groups, queued writes, drafts and theme preferences continue working. The PWA keeps its original manifest ID, start URL and worker URL; its name/icons and app-shell cache namespace are updated. Activation removes obsolete caches from both namespaces. No database migration or account recreation is required for the rename. The workspace directory remains unchanged.

Use `pnpm icons` to regenerate the original faircrumb SVG and PNG icons. Existing home-screen labels/icons can take time to refresh depending on the browser/OS; secure your account before reinstalling if you choose to refresh a saved home-screen entry.

## Account setup status

Settings shows separate stages for email confirmation and password setup. Once the Auth password is saved, it displays **Account secured**; use **Change password** to reveal the optional replacement field. Status refreshes after Auth events, reload, reconnecting, and returning from the confirmation email. If a confirmation is pending, **I’ve confirmed my email** checks status without sending another email.

Email links request a return to `https://your-host/?account=setup` (or the corresponding localhost origin), which opens Settings directly. Add that URL to Supabase's Auth redirect allowlist alongside the production Site URL. Confirming the email does not itself save a password; complete the final password step if Settings says **Email confirmed. One last step.** Passwords are not stored locally across redirects.

## Admin and anonymous-account recovery

See [the server-only Admin setup guide](docs/ADMIN_SETUP.md). Admin emails are configured as the JSON array `admin_priviledge` in a Supabase Edge Function secret, not a browser/Vite variable. `[]` disables all admins. Every admin request verifies the current Auth user and confirmed email server-side. New RPCs remain inaccessible to ordinary users.

The Admin tab lists users, all groups/ledgers, token status and activity. Historical token plaintext cannot be recovered from one-way hashes; an admin can reissue a 24-hour one-use token for ghost or eligible anonymous profiles. Redemption preserves the original profile and group/expense IDs and revokes the old session's profile access. Do not delete the old Auth row or rewrite profile IDs manually as a recovery shortcut.

### Invitations

Group invitations join signed-in users directly; new users complete normal onboarding first. Personal invitations claim the exact unclaimed profile you added and sign the recipient in automatically without typing a claim token. See [invite setup and behavior](INVITES.md).

### In-app expense notifications

The header bell shows unread updates, including on mobile. New expenses create one backend notification per included participant other than the author; zero-share/nonpaying members and settlements are excluded. Users can view expenses and mark individual or all updates as read. Updates arrive through Supabase Realtime while the app is open and are fetched again on reconnect/focus, with a periodic fallback. Offline expense notifications are created after successful sync. Unclaimed profiles retain updates for when their owner joins. Edits, restored expenses and sync retries do not create duplicate notifications. Existing historical expenses are not backfilled.

Apply `supabase/migrations/202610250003_notifications.sql` once in Supabase SQL Editor (after earlier migrations), then deploy the updated frontend. No new secrets or Edge Functions are required. The migration enables the notifications table in `supabase_realtime` and enforces recipient-only access. These are in-app updates; OS notifications while the PWA is closed require a separate Web Push feature. The inbox displays the latest 100 updates and its unread count includes all unread records.
