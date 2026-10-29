import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const mocks = vi.hoisted(() => ({ params: new URLSearchParams(), resend: vi.fn(), reset: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.params }));
vi.mock('next/link', () => ({ default: ({ children }: any) => <a>{children}</a> }));
vi.mock('@/components/auth/shared', () => ({ AuthLayout: ({ children }: any) => <div>{children}</div>, CheckIcon: () => null, AuthMessage: ({ children }: any) => <p>{children}</p> }));
vi.mock('@/lib/supabase-browser', () => ({ createBrowserClient: () => ({ auth: { resend: mocks.resend, resetPasswordForEmail: mocks.reset } }) }));
import ConfirmPage from './page';
let tree: ReactTestRenderer;
async function render(query = 'email=person%40example.com&type=signup') {
  mocks.params = new URLSearchParams(query);
  vi.stubGlobal('window', { location: { origin: 'https://linkdrift.app' } });
  await act(async () => { tree = create(<ConfirmPage />); });
  return () => tree.root.findByType('button');
}
afterEach(() => { if (tree) act(() => tree.unmount()); vi.resetAllMocks(); vi.unstubAllGlobals(); });
describe('confirmation resend', () => {
  it('resends signup through the session callback', async () => {
    mocks.resend.mockResolvedValue({ error: null }); const button = await render();
    await act(async () => button().props.onClick());
    expect(mocks.resend).toHaveBeenCalledWith({ type: 'signup', email: 'person@example.com', options: { emailRedirectTo: 'https://linkdrift.app/auth/callback' } });
    expect(JSON.stringify(tree.toJSON())).toContain('Email requested.');
  });
  it('uses recovery API for reset', async () => {
    mocks.reset.mockResolvedValue({ error: null }); const button = await render('email=person%40example.com&type=reset');
    await act(async () => button().props.onClick());
    expect(mocks.reset).toHaveBeenCalledWith('person@example.com', { redirectTo: 'https://linkdrift.app/auth/confirm' });
    expect(mocks.resend).not.toHaveBeenCalled();
  });
  it.each(['', 'email=%20', 'email=a%40b.com&type=unexpected'])('does not send for invalid context %s', async query => {
    const button = await render(query); await act(async () => button().props.onClick());
    expect(mocks.resend).not.toHaveBeenCalled(); expect(mocks.reset).not.toHaveBeenCalled();
  });
  it('blocks duplicate clicks and unlocks after provider failure', async () => {
    let resolve!: (value: any) => void;
    mocks.resend.mockReturnValue(new Promise(r => { resolve = r; })); const button = await render();
    let pending!: Promise<void>;
    act(() => { pending = button().props.onClick(); button().props.onClick(); });
    expect(mocks.resend).toHaveBeenCalledTimes(1); expect(button().props.disabled).toBe(true);
    await act(async () => { resolve({ error: { message: 'Rate limited' } }); await pending; });
    expect(button().props.disabled).toBe(false); expect(JSON.stringify(tree.toJSON())).toContain('Rate limited');
    mocks.resend.mockResolvedValue({ error: null }); await act(async () => button().props.onClick());
    expect(mocks.resend).toHaveBeenCalledTimes(2);
  });
  it('recovers from thrown network failure', async () => {
    mocks.resend.mockRejectedValue(new Error('offline')); const button = await render();
    await act(async () => button().props.onClick());
    expect(button().props.disabled).toBe(false); expect(JSON.stringify(tree.toJSON())).toContain('Please try again.');
  });
});
describe('admin setting read compatibility', () => {
  it.each(['src/app/admin/page.tsx', 'src/components/admin-sidebar.tsx'])('accepts boolean and legacy text true in %s', file => {
    const source = readFileSync(file, 'utf8');
    expect(source).toContain("s.value === true || s.value === 'true' || s.value === '1'");
  });
});
