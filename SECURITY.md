# Wondrous portal security

The upgraded portal uses Supabase Auth + Postgres Row Level Security.

## Authentication
- Students sign in with Supabase email/password.
- Supabase Auth manages the session and JWT.
- Admin access is a database role in profiles.role, not a hard-coded frontend password.
- Never commit service-role or secret keys.

## Database
- RLS is enabled on application tables.
- Students can see their own profile, enquiries, enrollments and payments.
- Admins can manage those records.
- Public users can only read active course/instructor information.

## Payment security
A live gateway must create orders and verify payment signatures on a trusted backend or Edge Function. Do not mark a payment paid merely because a browser reports success. The portal stores payment history in Postgres and provides the gateway integration point.

## Firewall
vercel.json adds browser/API hardening headers. A real network/WAF firewall is a hosting-layer control; enable Vercel Firewall/WAF rules or an equivalent provider for production, including rate limiting on login and payment endpoints.

## Production checklist
1. Create a Supabase project.
2. Run supabase/schema.sql.
3. Put the Supabase URL and publishable/anon key in config.js.
4. Create the admin Auth user and promote its profile to admin in SQL.
5. Configure a real payment provider and keep secret keys server-side.
6. Test RLS with both student and admin accounts.
7. Turn on MFA for admin accounts where possible.
