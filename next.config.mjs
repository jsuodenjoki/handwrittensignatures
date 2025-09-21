/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: [
      "lh3.googleusercontent.com",
      "pbs.twimg.com",
      "images.unsplash.com",
      "logos-world.net",
      // ei pakollinen WP:lle, koska WP-HTML renderöidään proxyn läpi
    ],
  },
  async headers() {
    return [
      // Ei cachea adminille / loginille
      {
        source: "/blog/:slug(wp-admin|wp-login\\.php)/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      // WP:n assetit voivat cachetua pitkään
      {
        source: "/blog/:path*(wp-content|wp-includes)/:file*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
