/**
 * Embedded Monetag slots only. Vendor code runs in opaque-origin sandboxed
 * frames, never in the application's document or authenticated JS context.
 * Site-wide MultiTag, popups and interstitials are deliberately unsupported.
 * See ./README.md for configuration, compatibility and rollout limitations.
 */

'use client';

import React, { createContext, useContext, useCallback } from 'react';
import { AD_FRAME_PERMISSIONS, buildAdFrameDocument, isAdZone } from './ad-frame';

interface AdConfig {
  enabled: boolean;
  siteId: string; // Legacy config only; the global MultiTag SDK is not loaded.
  nativeZone: string;
  bannerZone: string;
  interstitialZone: string; // Legacy config only; interstitials are disabled.
  feedAdInterval: number;
}

const DEFAULT_CONFIG: AdConfig = {
  enabled: process.env.NEXT_PUBLIC_MONETAG_ENABLED === 'true',
  siteId: process.env.NEXT_PUBLIC_MONETAG_SITE_ID || '',
  nativeZone: process.env.NEXT_PUBLIC_MONETAG_NATIVE_ZONE || '',
  bannerZone: process.env.NEXT_PUBLIC_MONETAG_BANNER_ZONE || '',
  interstitialZone: process.env.NEXT_PUBLIC_MONETAG_INTERSTITIAL_ZONE || '',
  feedAdInterval: parseInt(process.env.NEXT_PUBLIC_FEED_AD_INTERVAL || '6', 10),
};

// Retain the async public API without consulting or invoking any parent global.
const showInterstitial = async () => {};

interface AdContextType {
  config: AdConfig;
  loaded: boolean;
  showInterstitial: () => Promise<void>;
}

const AdContext = createContext<AdContextType>({
  config: DEFAULT_CONFIG,
  loaded: false,
  showInterstitial,
});

export const useAds = () => useContext(AdContext);

interface MoneytagProviderProps {
  children: React.ReactNode;
  override?: Partial<AdConfig>;
}

export function MoneytagProvider({ children, override }: MoneytagProviderProps) {
  const config = { ...DEFAULT_CONFIG, ...override };

  // No shared SDK or load callback exists. A frame load would not prove ad fill.
  return (
    <AdContext.Provider value={{ config, loaded: false, showInterstitial }}>
      {children}
    </AdContext.Provider>
  );
}

interface EmbeddedAdProps {
  zone: string;
  slot: 'native-feed' | 'banner';
  className?: string;
  style: React.CSSProperties;
}

function EmbeddedAd({ zone, slot, className, style }: EmbeddedAdProps) {
  const srcDoc = buildAdFrameDocument(zone);
  if (!srcDoc) return null;

  return (
    <div className={className} data-ad-slot={slot} style={{ ...style, overflow: 'hidden' }}>
      <iframe
        key={zone}
        title={slot === 'native-feed' ? 'Sponsored article advertisement' : 'Banner advertisement'}
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        allow={AD_FRAME_PERMISSIONS}
        referrerPolicy="no-referrer"
        loading="lazy"
        style={{ display: 'block', width: '100%', height: '100%', border: 0 }}
      />
    </div>
  );
}

interface NativeAdProps {
  className?: string;
}

export function NativeAd({ className }: NativeAdProps) {
  const { config } = useAds();
  if (!config.enabled) return null;

  return <EmbeddedAd zone={config.nativeZone} slot="native-feed" className={className}
    style={{ height: '100px', width: '100%', maxWidth: '100%' }} />;
}

interface BannerAdProps {
  className?: string;
  size?: 'leaderboard' | 'rectangle' | 'responsive';
}

export function BannerAd({ className, size = 'responsive' }: BannerAdProps) {
  const { config } = useAds();
  if (!config.enabled) return null;

  const sizeStyles: Record<NonNullable<BannerAdProps['size']>, React.CSSProperties> = {
    leaderboard: { width: '728px', height: '90px', maxWidth: '100%' },
    rectangle: { width: '300px', height: '250px', maxWidth: '100%' },
    responsive: { width: '100%', height: '90px', maxWidth: '100%' },
  };

  return <EmbeddedAd zone={config.bannerZone} slot="banner" className={className} style={sizeStyles[size]} />;
}

interface FeedWithAdsProps {
  articles: React.ReactNode[];
  renderAd?: () => React.ReactNode;
}

export function FeedWithAds({ articles, renderAd }: FeedWithAdsProps) {
  const { config } = useAds();

  // The custom renderer decorates the native slot. Avoid empty Sponsored cards
  // when its zone is not configured, including placeholder environment values.
  if (!config.enabled || !isAdZone(config.nativeZone)) {
    return <>{articles}</>;
  }

  const interval = config.feedAdInterval;
  const result: React.ReactNode[] = [];

  articles.forEach((article, i) => {
    result.push(article);
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

export function useArticleRedirect() {
  const redirectToArticle = useCallback(async (xUrl: string) => {
    // Keep the async API, but open synchronously with the user's gesture.
    window.open(xUrl, '_blank', 'noopener,noreferrer');
  }, []);

  return { redirectToArticle };
}
