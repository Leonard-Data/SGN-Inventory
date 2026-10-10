import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Recovery callback URLs contain one-time credentials; never print incoming URLs.
  logging: { incomingRequests: false },
};

export default nextConfig;
