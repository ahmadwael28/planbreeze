# Cloud sign-in setup (Supabase)

Planbreeze works without an account: plans are saved in the browser. These steps turn on
sign-in (Google, GitHub, email link) and cloud saving. They take about 20 minutes, most of it
for Google.

Replace `<project-ref>` below with your Supabase project's reference (the part before
`.supabase.co` in its URL).

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com), sign in, and click **New project**.
2. Name it `planbreeze`, pick the region closest to your users, and save the database password
   somewhere safe. Wait a minute or two for it to start.

## 2. Create the database table

1. Open **SQL Editor → New query**.
2. Paste the contents of [`supabase/schema.sql`](../supabase/schema.sql) and click **Run**.

This creates the `projects` table with row-level security, so each user can only read and change
their own plans.

## 3. Tell Supabase where the app lives

**Authentication → URL Configuration**

- **Site URL:** `https://ahmadwael28.github.io/planbreeze/`
- **Redirect URLs:** add both
  - `https://ahmadwael28.github.io/planbreeze/`
  - `http://localhost:5173/`

## 4. GitHub sign-in (about 2 minutes)

1. On GitHub: **Settings → Developer settings → OAuth Apps → New OAuth App**.
   - Application name: `Planbreeze`
   - Homepage URL: `https://ahmadwael28.github.io/planbreeze/`
   - Authorization callback URL: `https://<project-ref>.supabase.co/auth/v1/callback`
2. Click **Register application**, then **Generate a new client secret**.
3. In Supabase: **Authentication → Sign In / Providers → GitHub**. Turn it on, paste the
   **Client ID** and **Client secret**, and save.

## 5. Google sign-in (about 10 minutes)

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project named
   `Planbreeze`.
2. Go to **Google Auth Platform** (APIs & Services → OAuth consent screen) and fill in:
   - App name `Planbreeze`, your support email, audience **External**.
   - Authorized domain: `<project-ref>.supabase.co` (under Branding).
3. **Clients → Create client → Web application**:
   - Authorized JavaScript origins: `https://ahmadwael28.github.io` and `http://localhost:5173`
   - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
4. Copy the **Client ID** and **Client secret** into Supabase: **Authentication → Sign In /
   Providers → Google**. Turn it on and save.
5. Back in Google: under **Audience**, click **Publish app**. While the app is in "Testing",
   only the test users you list can sign in. The basic email/profile access Planbreeze uses
   doesn't need Google's review.

## 6. Email link sign-in

It's on by default (**Authentication → Sign In / Providers → Email**). Two things to know:

- Supabase's built-in email sender only sends a few emails per hour and is meant for testing.
  For real users, add your own SMTP service under **Authentication → Emails → SMTP Settings**
  (for example Resend, Postmark or Brevo, which have free tiers).
- The link must be opened in the same browser that asked for it (it's tied to that browser for
  security).

## 7. Connect the app

**Project Settings → API Keys**: copy the **Project URL** and the **publishable key**
(`sb_publishable_…`, or the legacy `anon` key).

These two values are public by design: they are built into the website. What protects users'
plans is the row-level security from step 2. **Never** share or ship the `secret` /
`service_role` key.

- **Live site:** add them as repository variables (not secrets), then re-run the deploy:

  ```bash
  gh variable set VITE_SUPABASE_URL --body "https://<project-ref>.supabase.co"
  ```

  ```bash
  gh variable set VITE_SUPABASE_PUBLISHABLE_KEY --body "sb_publishable_..."
  ```

  ```bash
  gh workflow run deploy.yml
  ```

- **Local development:** copy `.env.example` to `.env.local`, fill in the same values, and restart
  `npm run dev`.

## Free tier notes

- A free Supabase project pauses after 7 days without any activity. Resume it from the dashboard;
  nothing is lost. Signed-out use of the app is unaffected.
- Free limits (at the time of writing): 500 MB database, 50,000 monthly active users.
