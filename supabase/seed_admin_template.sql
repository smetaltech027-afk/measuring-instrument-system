-- Seed initial Admin membership AFTER creating smetaltech027@gmail.com in Supabase Auth.
-- Run via Supabase SQL Editor (postgres / service role) only after deployment approval.

INSERT INTO public.app_admins (user_id, email)
SELECT id, lower(email)
FROM auth.users
WHERE lower(email) = 'smetaltech027@gmail.com'
ON CONFLICT (user_id) DO NOTHING;

-- Verify exactly 1 admin exists:
SELECT user_id, email, created_at FROM public.app_admins;
