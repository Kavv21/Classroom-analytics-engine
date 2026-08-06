-- The on_auth_user_created trigger on auth.users was found disabled
-- (tgenabled = '0'), silently blocking all new user provisioning.
-- Supabase's hosted platform allows CREATE TRIGGER on auth.users (this
-- is how it was originally created in 0002) but NOT ALTER TABLE ...
-- ENABLE TRIGGER, since that specifically requires table ownership,
-- which belongs to supabase_auth_admin, not the postgres role migrations
-- run as. Drop and recreate instead — a freshly created trigger is
-- enabled by default.
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
