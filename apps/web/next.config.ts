import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  devIndicators: false,
  allowedDevOrigins: ['127.0.0.1'],
  transpilePackages: ['@stay/contracts', '@stay/domain'],
  images: { unoptimized: true },
};

export default nextConfig;
