/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Lets the sandbox/preview host (and any reverse proxy) reach the dev server,
  // and keeps the dev overlay from warning about cross-origin /_next/* requests.
  allowedDevOrigins: ['*.e2b.app', 'localhost', '127.0.0.1'],
  experimental: {
    serverActions: {
      allowedOrigins: ['*'],
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
