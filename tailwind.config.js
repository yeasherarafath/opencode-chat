/** @type {import('tailwindcss').Config} */

// Colors resolve to CSS variables defined in src/webview/styles.css, which in
// turn follow the active VS Code theme. Opacity modifiers (e.g. bg-primary/10)
// are supported through color-mix().
const token = (name) => ({ opacityValue }) =>
  opacityValue === undefined || opacityValue === "1"
    ? `var(--${name})`
    : `color-mix(in srgb, var(--${name}) calc(${opacityValue} * 100%), transparent)`;

module.exports = {
  content: ["./src/**/*.ts", "./src/**/*.html"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: {
          dim: token("surface-dim"),
          bright: token("surface-bright"),
          "container-lowest": token("surface-container-lowest"),
          "container-low": token("surface-container-low"),
          container: token("surface-container"),
          "container-high": token("surface-container-high"),
          "container-highest": token("surface-container-highest"),
        },
        primary: {
          DEFAULT: token("primary"),
          container: token("primary-container"),
          "fixed-dim": token("primary-fixed-dim"),
        },
        secondary: {
          DEFAULT: token("secondary"),
          container: token("secondary-container"),
        },
        tertiary: {
          DEFAULT: token("tertiary"),
          container: token("tertiary-container"),
        },
        outline: {
          DEFAULT: token("outline"),
          variant: token("outline-variant"),
        },
        error: {
          DEFAULT: token("error"),
          container: token("error-container"),
        },
        "on-surface": {
          DEFAULT: token("on-surface"),
          variant: token("on-surface-variant"),
        },
        "on-primary": token("on-primary"),
        "on-secondary": token("on-secondary"),
        hover: token("hover"),
      },
      fontFamily: {
        ui: ["var(--font-ui)"],
        code: ["var(--font-code)"],
        mono: ["var(--font-code)"],
      },
      fontSize: {
        "label": ["11px", "16px"],
        "body": ["13px", "20px"],
        "body-sm": ["12px", "18px"],
        "headline": ["14px", "22px"],
      },
      fontWeight: {
        label: "500",
        "headline": "600",
      },
      borderRadius: {
        sm: "3px",
        DEFAULT: "4px",
        md: "6px",
        lg: "8px",
        xl: "10px",
        "2xl": "14px",
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
