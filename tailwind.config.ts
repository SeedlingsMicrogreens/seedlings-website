import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  corePlugins: {
    // Keep the existing site's global/base styling intact during this UI standardization.
    preflight: false,
  },
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
