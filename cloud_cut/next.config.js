/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/public-api/:path*',
        destination: 'https://shadowfoam.despatchcloud.net/public-api/:path*',
      },
    ];
  },
}

module.exports = nextConfig 