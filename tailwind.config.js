/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.ts", "./src/**/*.html"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: {
          dim: "#131313",
          bright: "#393939",
          "container-lowest": "#0e0e0e",
          "container-low": "#1b1b1c",
          container: "#202020",
          "container-high": "#2a2a2a",
          "container-highest": "#353535",
        },
        primary: {
          DEFAULT: "#adc6ff",
          container: "#4d8eff",
          "fixed-dim": "#adc6ff",
        },
        secondary: {
          DEFAULT: "#c0c1ff",
          container: "#3131c0",
        },
        tertiary: {
          DEFAULT: "#ffb786",
          container: "#df7412",
        },
        outline: {
          DEFAULT: "#8c909f",
          variant: "#424754",
        },
        error: {
          DEFAULT: "#ffb4ab",
          container: "#93000a",
        },
        "on-surface": {
          DEFAULT: "#e5e2e1",
          variant: "#c2c6d6",
        },
        "on-primary": "#002e6a",
        "on-secondary": "#1000a9",
      },
      fontFamily: {
        ui: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        code: ["JetBrains Mono", "var(--vscode-editor-font-family)", "monospace"],
      },
      fontSize: {
        "label": ["11px", "16px"],
        "body": ["13px", "20px"],
        "body-sm": ["12px", "18px"],
        "headline": ["16px", "24px"],
      },
      fontWeight: {
        label: "500",
        "headline": "600",
      },
      borderRadius: {
        sm: "2px",
        DEFAULT: "4px",
        md: "6px",
        lg: "8px",
        xl: "12px",
        "2xl": "16px",
        full: "9999px",
      },
      spacing: {
        "0.5": "2px",
        "1.5": "6px",
        "2.5": "10px",
        "3.5": "14px",
        "4.5": "18px",
        "11": "44px",
      },
    },
  },
  plugins: [],
};
