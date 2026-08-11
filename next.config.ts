import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * This application holds clinical note text and photographs of handwritten
 * clinical notes. Every one of these headers exists because of a specific way
 * that content could leak or be used against the people it describes.
 *
 * `X-Frame-Options` in particular is not boilerplate here: a login screen that
 * can be framed is a login screen that can be overlaid, and the credentials
 * behind this one open a queue of other people's therapy sessions.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Never leak a URL containing a client id or submission id to a third party.
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    // The camera is how a paper note gets photographed and the microphone is
    // how a therapist dictates instead of typing. Nothing else is granted.
    value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Signed URLs for note photographs must never be cached by a proxy, and
        // the pages that render them must not be cached either — a shared
        // machine in a practice office is a realistic deployment.
        source: "/api/media/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
    ];
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  compress: true,
};

export default nextConfig;
