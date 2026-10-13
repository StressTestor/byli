-- Profiles never got a username: handle_new_user() inserted only the id, the
-- signup page's follow-up upsert ran before email confirmation (no session, so
-- RLS rejected it), and the OAuth callback only filled usernames for profiles
-- it created itself, which the trigger always beat it to.
--
-- Take the username from signup metadata instead: `username` from the email
-- signup form, `user_name` / `preferred_username` from OAuth providers. Skip it
-- when it is malformed or already taken; the auth callback assigns a fallback.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  wanted text := coalesce(
    NEW.raw_user_meta_data->>'username',
    NEW.raw_user_meta_data->>'user_name',
    NEW.raw_user_meta_data->>'preferred_username'
  );
BEGIN
  IF wanted IS NULL
     OR wanted !~ '^[A-Za-z0-9_-]{2,39}$'
     OR EXISTS (SELECT 1 FROM public.profiles WHERE username = wanted) THEN
    wanted := NULL;
  END IF;

  BEGIN
    INSERT INTO public.profiles (id, username, created_at, updated_at)
    VALUES (NEW.id, wanted, now(), now());
  EXCEPTION WHEN unique_violation THEN
    -- Lost a race for the same username; never block the signup over it.
    INSERT INTO public.profiles (id, created_at, updated_at)
    VALUES (NEW.id, now(), now());
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- Backfill existing GitHub profiles from the provider-set identity login.
UPDATE public.profiles p
SET username = i.identity_data->>'user_name'
FROM auth.identities i
WHERE i.user_id = p.id
  AND i.provider = 'github'
  AND p.username IS NULL
  AND (i.identity_data->>'user_name') ~ '^[A-Za-z0-9_-]{2,39}$'
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles taken
    WHERE taken.username = i.identity_data->>'user_name'
  );
