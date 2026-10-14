import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const state = vi.hoisted(() => ({
  insert: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock('@/lib/supabase-browser', () => ({
  createBrowserClient: () => ({
    auth: { getUser: state.getUser },
    from: (table: string) => table === 'categories'
      ? { select: () => ({ order: async () => ({ data: [] }) }) }
      : { insert: state.insert },
  }),
}));
import { SubmitArticleModal } from './submit-modal';

beforeEach(() => {
  state.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'synthetic-user' } } });
  state.insert.mockReset().mockResolvedValue({ error: null });
});

async function open(url = 'https://x.com/i/article/123') {
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<SubmitArticleModal onClose={() => {}} />); });
  await act(async () => { view.root.findByProps({ type: 'url' }).props.onChange({ target: { value: url } }); });
  return view;
}
async function submit(view: ReactTestRenderer) {
  await act(async () => { await view.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
}

describe('submission form compatibility', () => {
  it('sends only granted columns and still completes an ordinary submission', async () => {
    const view = await open();
    await submit(view);
    expect(state.insert).toHaveBeenCalledWith({ url: 'https://x.com/i/article/123', notes: null, category_id: null, submitted_by: 'synthetic-user' });
    expect(JSON.stringify(view.toJSON())).toContain('Your submission is being reviewed.');
    view.unmount();
  });
  it('rejects unsafe input before authentication or database work', async () => {
    const view = await open('javascript:alert(1)//x.com');
    await submit(view);
    expect(state.getUser).not.toHaveBeenCalled();
    expect(state.insert).not.toHaveBeenCalled();
    view.unmount();
  });
  it('handles a signed-out session without dereferencing a missing user', async () => {
    state.getUser.mockResolvedValue({ data: { user: null } });
    const view = await open();
    await submit(view);
    expect(state.insert).not.toHaveBeenCalled();
    expect(JSON.stringify(view.toJSON())).toContain('Please sign in');
    expect(view.root.findByProps({ type: 'submit' }).props.disabled).toBe(false);
    view.unmount();
  });
  it.each(['database', 'network'])('preserves retry and sanitizes %s failures', async failure => {
    if (failure === 'database') state.insert.mockResolvedValue({ error: { message: 'private SQL detail' } });
    else state.insert.mockRejectedValue(new Error('private SQL detail'));
    const view = await open();
    await submit(view);
    expect(JSON.stringify(view.toJSON())).toContain('Could not submit this article');
    expect(JSON.stringify(view.toJSON())).not.toContain('private SQL detail');
    expect(view.root.findByProps({ type: 'submit' }).props.disabled).toBe(false);
    view.unmount();
  });
});
