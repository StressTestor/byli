
-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, created_at, updated_at)
  VALUES (NEW.id, now(), now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Submission RLS: users can insert their own and read their own
CREATE POLICY "Users can submit articles" ON public.submissions
  FOR INSERT WITH CHECK (auth.uid() = submitted_by);

CREATE POLICY "Users can view own submissions" ON public.submissions
  FOR SELECT USING (auth.uid() = submitted_by);

-- Admins can do everything on submissions
CREATE POLICY "Admins can manage all submissions" ON public.submissions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
