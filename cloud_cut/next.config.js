/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  generateEtags: true,
  images: {
    domains: ['shadowfoam.despatchcloud.net'],
    unoptimized: true
  },
  experimental: {
    optimizeCss: true,
    turbo: {
      rules: {
        // Prevent certain files from being included in the build
        '**/*.test.*': ['**/*.test.js', '**/*.test.ts', '**/*.test.tsx'],
        '**/*.spec.*': ['**/*.spec.js', '**/*.spec.ts', '**/*.spec.tsx'],
      },
    },
  },
  // Skip static generation for API routes
  skipTrailingSlashRedirect: true,
  skipMiddlewareUrlNormalize: true,
  // Set to 'standalone' to optimize the build
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/api/public-api/:path*',
        destination: 'https://shadowfoam.despatchcloud.net/public-api/:path*',
      },
    ];
  },
  async headers() {
    return [
      {
        // Add CORS headers for API routes
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,DELETE,PATCH,POST,PUT,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()'
          }
        ]
      }
    ];
  }
}

module.exports = nextConfig 