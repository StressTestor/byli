import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BannerAd, FeedWithAds, MoneytagProvider, NativeAd, useAds, useArticleRedirect } from './monetag';
import { AD_FRAME_CSP } from './ad-frame';

const enabledConfig = {
  enabled: true, siteId: '101', nativeZone: '202', bannerZone: '303', interstitialZone: '404',
};
const views: ReactTestRenderer[] = [];
let parentScriptAppend: ReturnType<typeof vi.fn>;
let createElement: ReturnType<typeof vi.fn>;
let legacyInterstitial: ReturnType<typeof vi.fn>;
let open: ReturnType<typeof vi.fn>;
let ads: ReturnType<typeof useAds>;
let redirect: ReturnType<typeof useArticleRedirect>;

function Probe() {
  ads = useAds();
  redirect = useArticleRedirect();
  return <output>{String(ads.loaded)}</output>;
}

function Page({ enabled = true, showAds = true, nativeZone = '202' }) {
  return (
    <MoneytagProvider override={{ ...enabledConfig, enabled, nativeZone }}>
      <Probe />
      {showAds ? <><NativeAd className="native" /><BannerAd className="banner" size="rectangle" /></> : <main>Another route</main>}
    </MoneytagProvider>
  );
}

async function render(element: React.ReactElement) {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(element, {
      createNodeMock: () => ({ querySelector: () => null, appendChild: parentScriptAppend }),
    });
  });
  views.push(view);
  return view;
}

beforeEach(() => {
  parentScriptAppend = vi.fn();
  createElement = vi.fn(() => ({ dataset: {} }));
  legacyInterstitial = vi.fn();
  open = vi.fn();
  vi.stubGlobal('document', {
    createElement,
    getElementById: vi.fn(() => null),
    head: { appendChild: parentScriptAppend },
  });
  vi.stubGlobal('window', { show_404: legacyInterstitial, open });
});

afterEach(async () => {
  await act(async () => { views.splice(0).forEach((view) => view.unmount()); });
  vi.unstubAllGlobals();
});

describe('isolated embedded ads', () => {
  it('renders native and banner scripts only inside opaque-origin sandboxed frames', async () => {
    const view = await render(<Page />);
    const frames = view.root.findAllByType('iframe');
    expect(frames).toHaveLength(2);
    for (const [index, frame] of frames.entries()) {
      expect(frame.props.sandbox).toBe('allow-scripts');
      expect(frame.props.referrerPolicy).toBe('no-referrer');
      expect(frame.props.allow).toContain("camera 'none'");
      expect(frame.props.allow).toContain("microphone 'none'");
      expect(frame.props.allow).toContain("geolocation 'none'");
      expect(frame.props.allow).toContain("fullscreen 'none'");
      expect(frame.props.allow).toContain("payment 'none'");
      expect(frame.props.loading).toBe('lazy');
      expect(frame.props.title).toBeTruthy();
      expect(frame.props.srcDoc).toContain(`https://alwingore.com/js/zone/${index === 0 ? '202' : '303'}.js`);
      expect(frame.props.srcDoc).toContain('<meta name="referrer" content="no-referrer">');
      expect(frame.props.srcDoc).toContain(`<meta http-equiv="Content-Security-Policy" content="${AD_FRAME_CSP}">`);
      expect(frame.props.srcDoc).not.toContain('/js/site/');
      expect(frame.props.src).toBeUndefined();
      expect(frame.props.dangerouslySetInnerHTML).toBeUndefined();
      expect(frame.props.style).toMatchObject({ width: '100%', height: '100%', border: 0 });
    }
    expect(view.root.findByProps({ 'data-ad-slot': 'native-feed' }).props.className).toBe('native');
    expect(view.root.findByProps({ 'data-ad-slot': 'banner' }).props.style).toMatchObject({
      width: '300px', maxWidth: '100%', height: '250px', overflow: 'hidden',
    });
    expect(view.root.findAllByType('script')).toHaveLength(0);
    expect(createElement).not.toHaveBeenCalled();
    expect(parentScriptAppend).not.toHaveBeenCalled();
    expect(ads.loaded).toBe(false);
  });

  it('needs only a zone, never a global site SDK or an SDK loaded signal', async () => {
    const view = await render(
      <MoneytagProvider override={{ ...enabledConfig, siteId: '' }}>
        <NativeAd /><BannerAd /><Probe />
      </MoneytagProvider>,
    );
    expect(view.root.findAllByType('iframe')).toHaveLength(2);
    expect(ads.loaded).toBe(false);
    expect(parentScriptAppend).not.toHaveBeenCalled();
  });

  it('renders no frames or scripts when disabled or when only the provider is mounted', async () => {
    const disabled = await render(<Page enabled={false} />);
    expect(disabled.root.findAllByType('iframe')).toHaveLength(0);
    const providerOnly = await render(<MoneytagProvider override={enabledConfig}><Probe /></MoneytagProvider>);
    expect(providerOnly.root.findAllByType('iframe')).toHaveLength(0);
    expect(createElement).not.toHaveBeenCalled();
    expect(parentScriptAppend).not.toHaveBeenCalled();
  });

  it.each(['', ' ', '202\n', '202\r', '202\t', '202/../../site/1', '202?x=1',
    '202&quot; onload=&quot;alert(1)', '202"><script>alert(1)</script>', '</script><script>alert(1)</script>',
    '%32%30%32', '２０２', 'your-native-zone-id'])('rejects invalid zone %j before building any frame', async (zone) => {
    const view = await render(
      <MoneytagProvider override={{ ...enabledConfig, nativeZone: zone, bannerZone: zone }}>
        <NativeAd /><BannerAd />
      </MoneytagProvider>,
    );
    expect(view.toJSON()).toBeNull();
    expect(parentScriptAppend).not.toHaveBeenCalled();
  });

  it('tears down frames on disable, route removal, and provider unmount without parent SDK residue', async () => {
    const view = await render(<Page />);
    expect(view.root.findAllByType('iframe')).toHaveLength(2);
    await act(async () => view.update(<Page enabled={false} />));
    expect(view.root.findAllByType('iframe')).toHaveLength(0);
    await act(async () => view.update(<Page />));
    expect(view.root.findAllByType('iframe')).toHaveLength(2);
    await act(async () => view.update(<Page showAds={false} />));
    expect(view.root.findAllByType('iframe')).toHaveLength(0);
    await act(async () => view.update(<Page />));
    await act(async () => view.unmount());
    expect(view.toJSON()).toBeNull();
    expect(createElement).not.toHaveBeenCalled();
    expect(parentScriptAppend).not.toHaveBeenCalled();
    expect(legacyInterstitial).not.toHaveBeenCalled();
  });

  it('replaces a frame when its zone changes and removes it when the next zone is invalid', async () => {
    const view = await render(<Page />);
    const originalFrame = view.root.findAllByType('iframe')[0];
    await act(async () => view.update(<Page nativeZone="505" />));
    const nextFrame = view.root.findAllByType('iframe')[0];
    expect(nextFrame).not.toBe(originalFrame);
    expect(nextFrame.props.srcDoc).toContain('/js/zone/505.js');
    expect(nextFrame.props.srcDoc).not.toContain('/js/zone/202.js');
    await act(async () => view.update(<Page nativeZone="invalid" />));
    expect(view.root.findAllByType('iframe')).toHaveLength(1);
    expect(parentScriptAppend).not.toHaveBeenCalled();
  });

  it('keeps interstitial calls inert and redirects without invoking a parent SDK or delaying', async () => {
    await render(<Page />);
    await expect(ads.showInterstitial()).resolves.toBeUndefined();
    const done = redirect.redirectToArticle('https://x.com/article/123');
    expect(open).toHaveBeenCalledWith('https://x.com/article/123', '_blank', 'noopener,noreferrer');
    await expect(done).resolves.toBeUndefined();
    expect(legacyInterstitial).not.toHaveBeenCalled();
    expect(parentScriptAppend).not.toHaveBeenCalled();
  });

  it('preserves feed placement and custom ad rendering', async () => {
    const articles = Array.from({ length: 13 }, (_, i) => <article key={i}>Article {i}</article>);
    const view = await render(
      <MoneytagProvider override={{ ...enabledConfig, feedAdInterval: 6 }}>
        <FeedWithAds articles={articles} />
      </MoneytagProvider>,
    );
    expect(view.root.findAllByType('article')).toHaveLength(13);
    expect(view.root.findAllByType('iframe')).toHaveLength(2);
    expect(view.root.findAll((node) => node.props['data-ad-position']).map((node) => node.props['data-ad-position'])).toEqual([6, 12]);
    await act(async () => view.update(
      <MoneytagProvider override={{ ...enabledConfig, feedAdInterval: 6 }}>
        <FeedWithAds articles={articles} renderAd={() => <aside>Custom slot</aside>} />
      </MoneytagProvider>,
    ));
    expect(view.root.findAllByType('aside')).toHaveLength(2);
    expect(view.root.findAllByType('iframe')).toHaveLength(0);
  });

  it.each(['', 'bad-zone'])('omits empty decorated feed slots for zone %j', async (nativeZone) => {
    const renderAd = vi.fn(() => <aside>Sponsored<NativeAd /></aside>);
    const view = await render(
      <MoneytagProvider override={{ ...enabledConfig, nativeZone, feedAdInterval: 1 }}>
        <FeedWithAds articles={[<article key="1">First</article>, <article key="2">Second</article>]} renderAd={renderAd} />
      </MoneytagProvider>,
    );
    expect(view.root.findAllByType('article')).toHaveLength(2);
    expect(view.root.findAllByType('aside')).toHaveLength(0);
    expect(renderAd).not.toHaveBeenCalled();
  });

  it.each([
    ['leaderboard', '728px', '90px'], ['rectangle', '300px', '250px'], ['responsive', '100%', '90px'],
  ] as const)('contains %s banners at their declared dimensions', async (size, width, height) => {
    const view = await render(
      <MoneytagProvider override={enabledConfig}><BannerAd size={size} /></MoneytagProvider>,
    );
    expect(view.root.findByProps({ 'data-ad-slot': 'banner' }).props.style).toMatchObject({
      width, height, maxWidth: '100%', overflow: 'hidden',
    });
  });
});
