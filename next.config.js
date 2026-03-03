/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverComponentsExternalPackages: ['graphql'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'pbs.twimg.com' },  // X profile images
      { protocol: 'https', hostname: '*.supabase.co' },   // Supabase storage
    ],
  },
};

module.exports = nextConfig;
