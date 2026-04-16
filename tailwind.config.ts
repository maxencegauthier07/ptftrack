import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#06080c",
        card: "#0d1117",
        hover: "#151b25",
        border: "#1b2332",
        dim: "#484f58",
        muted: "#6e7681",
        bright: "#e6edf3",
        accent: "#58a6ff",
        up: "#3fb950",
        down: "#f85149",
        "up-bg": "#0d2818",
        "down-bg": "#3d1214",
      },
      fontFamily: {
        mono: ["'Geist Mono'", "'JetBrains Mono'", "'SF Mono'", "monospace"],
        sans: ["'Geist'", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
