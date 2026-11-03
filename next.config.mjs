// Firebase project id: the sign-in handler pages live on https://<project>.firebaseapp.com
const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "centerexam-e0b07";

export default {
  serverExternalPackages: ["firebase-admin"],
  webpack: (config) => {
    config.resolve.alias.canvas = false; // pdfjs-dist optional dependency
    return config;
  },
  // Google sign-in on iPhone/Safari fails ("missing initial state") when the sign-in page is on another domain than the site.
  // These rewrites serve Firebase's handler from OUR domain (https://our-site/__/auth/handler), so storage is not partitioned.
  async rewrites() {
    return [
      { source: "/__/auth/:path*", destination: `https://${PROJECT}.firebaseapp.com/__/auth/:path*` },
      { source: "/__/firebase/init.json", destination: `https://${PROJECT}.firebaseapp.com/__/firebase/init.json` },
    ];
  },
};
