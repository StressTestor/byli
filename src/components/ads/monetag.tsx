/**
 * Linkdrift Ad System
 * 
 * Monetag integration with three layers:
 *   1. MoneytagProvider — loads MultiTag script in <head>, provides context
 *   2. NativeAd        — in-feed native ad unit (blends with article cards)
 *   3. BannerAd        — standard banner for sidebar/footer
 *   4. InterstitialAd  — shown on article redirect (user is leaving to X)
 * 
 * All ads are gated behind NEXT_PUBLIC_MONETAG_ENABLED=true
 * so they can be killed instantly for acquisition demos.
 * 
 * Placement strategy:
 *   - Native ad every 5-7 articles in feed (configurable)
 *   - Banner in sidebar on desktop (collapses on mobile)
 *   - Interstitial on article click-through to X (low friction — they're leaving anyway)
 *   - NO popunders, NO push notification prompts, NO pre-content blocking
 * 
 * Env vars:
 *   NEXT_PUBLIC_MONETAG_ENABLED=true|false
 *   NEXT_PUBLIC_MONETAG_SITE_ID=your-monetag-site-id
 *   NEXT_PUBLIC_MONETAG_NATIVE_ZONE=zone-id-for-native-ads
 *   NEXT_PUBLIC_MONETAG_BANNER_ZONE=zone-id-for-banner-ads
 *   NEXT_PUBLIC_MONETAG_INTERSTITIAL_ZONE=zone-id-for-interstitial
 */

'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

// ─── Config ──────────────────────────────────────────────────────────

interface AdConfig {
  enabled: boolean;
  siteId: string;
  nativeZone: string;
  bannerZone: string;
  interstitialZone: string;
  feedAdInterval: number; // show ad every N articles
}

const DEFAULT_CONFIG: AdConfig = {
  enabled: process.env.NEXT_PUBLIC_MONETAG_ENABLED === 'true',
  siteId: process.env.NEXT_PUBLIC_MONETAG_SITE_ID || '',
  nativeZone: process.env.NEXT_PUBLIC_MONETAG_NATIVE_ZONE || '',
  bannerZone: process.env.NEXT_PUBLIC_MONETAG_BANNER_ZONE || '',
  interstitialZone: process.env.NEXT_PUBLIC_MONETAG_INTERSTITIAL_ZONE || '',
  feedAdInterval: parseInt(process.env.NEXT_PUBLIC_FEED_AD_INTERVAL || '6', 10),
};

// ─── Context ─────────────────────────────────────────────────────────

interface AdContextType {
  config: AdConfig;
  loaded: boolean;
  showInterstitial: () => Promise<void>;
}

const AdContext = createContext<AdContextType>({
  config: DEFAULT_CONFIG,
  loaded: false,
  showInterstitial: async () => {},
});

export const useAds = () => useContext(AdContext);

// ─── Provider ────────────────────────────────────────────────────────

interface MoneytagProviderProps {
  children: React.ReactNode;
  override?: Partial<AdConfig>; // for testing/demos
}

export function MoneytagProvider({ children, override }: MoneytagProviderProps) {
  const [loaded, setLoaded] = useState(false);
  const config = { ...DEFAULT_CONFIG, ...override };

  useEffect(() => {
    if (!config.enabled || !config.siteId) return;

    // Check if already loaded
    if (document.getElementById('monetag-multitag')) {
      setLoaded(true);
      return;
    }

    // Load Monetag MultiTag script
    const script = document.createElement('script');
    script.id = 'monetag-multitag';
    script.src = `https://alwingore.com/js/site/${config.siteId}.js`;
    script.async = true;
    script.dataset.cfasync = 'false';

    script.onload = () => setLoaded(true);
    script.onerror = () => {
      console.warn('[Linkdrift Ads] Monetag script failed to load');
      setLoaded(false);
    };

    // Monetag wants script in <head>, as high as possible
    document.head.appendChild(script);

    return () => {
      // Don't remove on unmount — Monetag manages its own lifecycle
    };
  }, [config.enabled, config.siteId]);

  const showInterstitial = useCallback(async () => {
    if (!config.enabled || !config.interstitialZone || !loaded) return;

    try {
      // Monetag SDK exposes show_ZONEID() globally after script load
      const showFn = (window as any)[`show_${config.interstitialZone}`];
      if (typeof showFn === 'function') {
        await showFn({ requestVar: 'article_redirect' });
      }
    } catch (err) {
      // Ad failed to show — not critical, user still redirects
      console.warn('[Linkdrift Ads] Interstitial failed:', err);
    }
  }, [config.enabled, config.interstitialZone, loaded]);

  return (
    <AdContext.Provider value={{ config, loaded, showInterstitial }}>
      {children}
    </AdContext.Provider>
  );
}

// ─── Native Ad Component ─────────────────────────────────────────────
// Renders an in-feed ad unit styled to blend with article cards.
// Monetag native ads inject into a container div with a data-zone attr.

interface NativeAdProps {
  className?: string;
}

export function NativeAd({ className }: NativeAdProps) {
  const { config, loaded } = useAds();
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!config.enabled || !config.nativeZone || !loaded || !containerRef.current) return;

    // Monetag native ads: create a container with the zone script
    const existing = containerRef.current.querySelector('script');
    if (existing) return; // already injected

    const script = document.createElement('script');
    script.async = true;
    script.dataset.cfasync = 'false';
    script.src = `https://alwingore.com/js/zone/${config.nativeZone}.js`;
    containerRef.current.appendChild(script);
  }, [config.enabled, config.nativeZone, loaded]);

  if (!config.enabled || !config.nativeZone) return null;

  return (
    <div
      ref={containerRef}
      className={className}
      data-ad-slot="native-feed"
      style={{ minHeight: '100px', width: '100%' }}
    >
      {/* Monetag injects native ad content here */}
    </div>
  );
}

// ─── Banner Ad Component ─────────────────────────────────────────────
// Standard display banner. Used in sidebar (desktop) or between sections.

interface BannerAdProps {
  className?: string;
  size?: 'leaderboard' | 'rectangle' | 'responsive';
}

export function BannerAd({ className, size = 'responsive' }: BannerAdProps) {
  const { config, loaded } = useAds();
  const containerRef = React.useRef<HTMLDivElement>(null);

  const sizeStyles: Record<string, React.CSSProperties> = {
    leaderboard: { width: '728px', height: '90px', maxWidth: '100%' },
    rectangle: { width: '300px', height: '250px' },
    responsive: { width: '100%', minHeight: '90px' },
  };

  useEffect(() => {
    if (!config.enabled || !config.bannerZone || !loaded || !containerRef.current) return;

    const existing = containerRef.current.querySelector('script');
    if (existing) return;

    const script = document.createElement('script');
    script.async = true;
    script.dataset.cfasync = 'false';
    script.src = `https://alwingore.com/js/zone/${config.bannerZone}.js`;
    containerRef.current.appendChild(script);
  }, [config.enabled, config.bannerZone, loaded]);

  if (!config.enabled || !config.bannerZone) return null;

  return (
    <div
      ref={containerRef}
      className={className}
      data-ad-slot="banner"
      style={sizeStyles[size]}
    >
      {/* Monetag injects banner ad here */}
    </div>
  );
}

// ─── Feed Ad Inserter ────────────────────────────────────────────────
// Utility: takes an array of article elements and inserts NativeAd
// components at the configured interval.

interface FeedWithAdsProps {
  articles: React.ReactNode[];
  renderAd?: () => React.ReactNode;
}

export function FeedWithAds({ articles, renderAd }: FeedWithAdsProps) {
  const { config } = useAds();

  if (!config.enabled) {
    return <>{articles}</>;
  }

  const interval = config.feedAdInterval;
  const result: React.ReactNode[] = [];

  articles.forEach((article, i) => {
    result.push(article);

    // Insert ad after every `interval` articles (not before the first batch)
    if ((i + 1) % interval === 0 && i < articles.length - 1) {
      result.push(
        <div key={`ad-${i}`} data-ad-position={i + 1}>
          {renderAd ? renderAd() : <NativeAd />}
        </div>
      );
    }
  });

  return <>{result}</>;
}

// ─── Article Redirect with Interstitial ──────────────────────────────
// Hook: shows an interstitial ad before redirecting to X article URL.
// The ad is non-blocking — if it fails, redirect happens anyway.

export function useArticleRedirect() {
  const { showInterstitial, config } = useAds();

  const redirectToArticle = useCallback(async (xUrl: string) => {
    if (config.enabled) {
      // Show interstitial, then redirect regardless of outcome
      try {
        await Promise.race([
          showInterstitial(),
          new Promise(resolve => setTimeout(resolve, 3000)), // 3s max wait
        ]);
      } catch {
        // Ad failed, redirect anyway
      }
    }

    // Open X article in new tab
    window.open(xUrl, '_blank', 'noopener,noreferrer');
  }, [showInterstitial, config.enabled]);

  return { redirectToArticle };
}
