export default {
  serverExternalPackages: ["firebase-admin"],
  webpack: (config) => {
    config.resolve.alias.canvas = false; // pdfjs-dist optional dependency
    return config;
  },
};
