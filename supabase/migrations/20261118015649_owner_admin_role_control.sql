-- Only Joe's verified owner session may create or remove administrators.
-- A service-role application request is deliberately NOT owner authentication.
CREATE OR REPLACE FUNCTION public.prevent_profile_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  old_role text;
  owner_session boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.id = '11ca70b7-4ecf-4446-a6cb-47eb80e84d44'::uuid THEN
      RAISE EXCEPTION 'Owner account cannot be deleted' USING ERRCODE = '42501';
    END IF;
    IF OLD.role = 'admin' THEN
      IF NOT (coalesce(auth.uid()='11ca70b7-4ecf-4446-a6cb-47eb80e84d44'::uuid,false)
        AND EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id=auth.uid() AND i.provider='github' AND i.provider_id='212606152')) THEN
        RAISE EXCEPTION 'Only owner session may remove an administrator' USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.admin_logs(admin_id,action,target_type,target_id,metadata)
        VALUES (auth.uid(),'admin_profile_deleted','profile',OLD.id::text,jsonb_build_object('old_role',OLD.role));
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN old_role := OLD.role; END IF;
  IF (TG_OP = 'UPDATE' AND NEW.role IS NOT DISTINCT FROM OLD.role)
     OR (TG_OP = 'INSERT' AND NEW.role = 'user') THEN RETURN NEW; END IF;

  IF NEW.id = '11ca70b7-4ecf-4446-a6cb-47eb80e84d44'::uuid AND NEW.role <> 'admin' THEN
    RAISE EXCEPTION 'Owner account cannot be demoted' USING ERRCODE = '42501';
  END IF;

  owner_session := auth.uid() = '11ca70b7-4ecf-4446-a6cb-47eb80e84d44'::uuid
    AND EXISTS (SELECT 1 FROM auth.identities i
      WHERE i.user_id = auth.uid() AND i.provider = 'github' AND i.provider_id = '212606152');
  IF NEW.role = 'admin' OR old_role = 'admin' THEN
    IF NOT coalesce(owner_session, false) THEN
      RAISE EXCEPTION 'Only owner session may grant or remove admin role' USING ERRCODE = '42501';
    END IF;
  ELSIF coalesce(auth.role(), '') <> 'service_role'
      AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.role='admin') THEN
    RAISE EXCEPTION 'Role changes require an administrator' USING ERRCODE = '42501';
  END IF;
  IF NEW.role = 'admin' OR old_role = 'admin' THEN
    INSERT INTO public.admin_logs(admin_id,action,target_type,target_id,metadata)
      VALUES (auth.uid(),'admin_role_changed','profile',NEW.id::text,jsonb_build_object('old_role',old_role,'new_role',NEW.role));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_profile_role_change() FROM PUBLIC, anon, authenticated, service_role;
-- The existing INSERT/UPDATE triggers continue to invoke this function.
-- Permit the owner session path without handing a service-role key to clients.
GRANT UPDATE (role) ON public.profiles TO authenticated;
CREATE POLICY "owner can manage profile roles" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid()='11ca70b7-4ecf-4446-a6cb-47eb80e84d44'::uuid)
  WITH CHECK (auth.uid()='11ca70b7-4ecf-4446-a6cb-47eb80e84d44'::uuid);
-- Existing admin SELECT policies allow the owner to target other profiles;
-- all UPDATE paths still pass the immutable identity trigger above.

DROP TRIGGER IF EXISTS trg_profiles_prevent_admin_delete ON public.profiles;
CREATE TRIGGER trg_profiles_prevent_admin_delete BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_role_change();
