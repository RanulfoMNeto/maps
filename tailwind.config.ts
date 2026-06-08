import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17211c",
        canopy: "#1d6a4a",
        moss: "#8fb65d",
        water: "#287d99",
        soil: "#a36f3f",
        ember: "#bf4b2f"
      },
      boxShadow: {
        soft: "0 18px 55px rgba(23, 33, 28, 0.12)"
      }
    }
  },
  plugins: []
};

export default config;
