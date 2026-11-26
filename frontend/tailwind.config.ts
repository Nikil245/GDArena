import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
        ],
      },
      colors: {
        page: "var(--bg-page)",
        surface: "var(--bg-surface)",
        subtle: "var(--bg-subtle)",
        muted: "var(--bg-muted)",
        ink: {
          DEFAULT: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          placeholder: "var(--text-placeholder)",
        },
        line: {
          DEFAULT: "var(--border-default)",
          subtle: "var(--border-subtle)",
          input: "var(--border-input)",
          strong: "var(--border-strong)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          soft: "var(--accent-soft)",
          border: "var(--accent-border)",
          text: "var(--accent-text)",
        },
        success: {
          bg: "var(--success-bg)",
          border: "var(--success-border)",
          text: "var(--success-text)",
        },
        danger: {
          bg: "var(--danger-bg)",
          border: "var(--danger-border)",
          text: "var(--danger-text)",
          solid: "var(--danger-solid)",
          solidHover: "var(--danger-solid-hover)",
        },
      },
      borderRadius: {
        chip: "var(--radius-sm)",
        control: "var(--radius-md)",
        card: "var(--radius-lg)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        popover: "var(--shadow-popover)",
      },
      fontSize: {
        "page-title": ["1.5rem", { lineHeight: "2rem", letterSpacing: "-0.02em" }],
        "section-title": ["1rem", { lineHeight: "1.5rem" }],
        "card-title": ["0.875rem", { lineHeight: "1.25rem" }],
        caption: ["0.75rem", { lineHeight: "1.125rem" }],
      },
    },
  },
  plugins: [],
};

export default config;
