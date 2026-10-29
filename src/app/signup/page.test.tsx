import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ signup: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('next/link', () => ({ default: ({ children }: any) => <a>{children}</a> }));
vi.mock('@/lib/supabase-browser', () => ({ createBrowserClient: () => ({ auth: { signUp: mocks.signup } }) }));
import SignupPage from './page';
let tree: ReactTestRenderer;
const generated = 'vA7-strong-Password-!@#$%^&*()';
async function render() {
  vi.stubGlobal('window', { location: { origin: 'https://linkdrift.app' } });
  vi.stubGlobal('FormData', class { constructor(private form: Record<string, string>) {} get(name: string) { return this.form[name] ?? null; } });
  await act(async () => { tree = create(<SignupPage />); });
}
const event = (password = generated, username = 'reader') => ({ preventDefault: vi.fn(), currentTarget: { username, email: 'reader@example.com', password } });
const submit = (e = event()) => tree.root.findByType('form').props.onSubmit(e);
afterEach(() => { if (tree) act(() => tree.unmount()); vi.resetAllMocks(); vi.unstubAllGlobals(); });
describe('signup autofill and retries', () => {
  it('submits native form values even when React state has received no change events', async () => {
    mocks.signup.mockResolvedValue({ error: null }); await render();
    await act(async () => submit());
    expect(mocks.signup).toHaveBeenCalledWith({ email: 'reader@example.com', password: generated, options: { emailRedirectTo: 'https://linkdrift.app/auth/callback', data: { username: 'reader' } } });
    expect(mocks.push).toHaveBeenCalledWith('/auth/confirm?email=reader%40example.com&type=signup');
  });
  it('leaves signup inputs uncontrolled so rerenders do not replace autofilled DOM values', async () => {
    await render(); const inputs = tree.root.findAllByType('input');
    expect(inputs).toHaveLength(3);
    for (const input of inputs) expect(input.props.value).toBeUndefined();
    expect(inputs[2].props.autoComplete).toBe('new-password');
    await act(async () => inputs[0].props.onInput({ currentTarget: { value: 'updated' } }));
    expect(tree.root.findAllByType('input').every(input => input.props.value === undefined)).toBe(true);
  });
  it('continues validating actual submitted values', async () => {
    await render(); await act(async () => submit(event('short')));
    expect(mocks.signup).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain('Password must be at least 8 characters.');
  });
  it('keeps passwords unchanged including spaces', async () => {
    mocks.signup.mockResolvedValue({ error: null }); await render();
    await act(async () => submit(event('  password with spaces  ')));
    expect(mocks.signup.mock.calls[0][0].password).toBe('  password with spaces  ');
  });
  it('unlocks submission after a thrown network error and permits retry', async () => {
    mocks.signup.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ error: null }); await render();
    await act(async () => submit());
    expect(tree.root.findAllByType('button').find(button => button.props.type === 'submit')!.props.disabled).toBe(false);
    expect(JSON.stringify(tree.toJSON())).toContain('Could not create your account.');
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => submit()); expect(mocks.signup).toHaveBeenCalledTimes(2); expect(mocks.push).toHaveBeenCalledTimes(1);
  });
  it('shows provider errors without navigating', async () => {
    mocks.signup.mockResolvedValue({ error: { message: 'Password rejected' } }); await render();
    await act(async () => submit()); expect(mocks.push).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain('Password rejected');
  });
  it('blocks repeated submissions while pending', async () => {
    let resolve!: (value: any) => void;
    mocks.signup.mockReturnValue(new Promise(r => { resolve = r; })); await render();
    let pending!: Promise<void>;
    act(() => { pending = submit(); submit(); });
    expect(mocks.signup).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ error: null }); await pending; });
  });
});
