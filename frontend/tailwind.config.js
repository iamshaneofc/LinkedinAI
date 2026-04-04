import tailwindcssAnimate from "tailwindcss-animate"

/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ["class"],
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        container: {
            center: true,
            padding: "2rem",
            screens: { "2xl": "1400px" },
        },
        extend: {
            colors: {
                dark: { 900: '#05080f', 800: '#0d1421', 700: '#1a2233' },
                heading: {
                    1: "hsl(var(--heading-1))",
                    2: "hsl(var(--heading-2))",
                },
                separator: "hsl(var(--separator))",
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                    500: '#663EB6',
                    600: '#5529a0',
                },
                secondaryBtn: "hsl(var(--secondary-btn))",
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
                xl: "calc(var(--radius) + 4px)",
                "2xl": "calc(var(--radius) + 8px)",
                "3xl": "calc(var(--radius) + 16px)",
            },
            fontFamily: {
                sans: ['Montserrat', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
                heading: ['Exo 2', 'system-ui', 'sans-serif'],
                quote: ['Lora', 'Georgia', 'serif'],
            },
            fontSize: {
                'heading-1': ['40px', { lineHeight: '1.2', fontWeight: '700' }],
                'heading-2': ['32px', { lineHeight: '1.2', fontWeight: '700' }],
                'quote': ['22px', { lineHeight: '1.5', fontStyle: 'italic' }],
            },
            backdropBlur: {
                xs: '2px',
                sm: '4px',
                md: '8px',
                lg: '16px',
                xl: '24px',
                '2xl': '40px',
                '3xl': '64px',
            },
            boxShadow: {
                'glow-sm': '0 0 10px -2px hsl(var(--primary) / 0.3)',
                'glow-md': '0 0 20px -4px hsl(var(--primary) / 0.35)',
                'glow-lg': '0 0 40px -8px hsl(var(--primary) / 0.4)',
                'card': '0 1px 2px hsl(0 0% 0% / 0.04), 0 4px 12px -2px hsl(0 0% 0% / 0.06), 0 0 0 1px hsl(var(--border) / 0.6)',
                'card-hover': '0 2px 4px hsl(0 0% 0% / 0.06), 0 12px 32px -4px hsl(0 0% 0% / 0.12), 0 0 0 1px hsl(var(--border))',
            },
            keyframes: {
                "accordion-down": {
                    from: { height: "0" },
                    to: { height: "var(--radix-accordion-content-height)" },
                },
                "accordion-up": {
                    from: { height: "var(--radix-accordion-content-height)" },
                    to: { height: "0" },
                },
                "float": {
                    "0%, 100%": { transform: "translateY(0px)" },
                    "50%": { transform: "translateY(-4px)" },
                },
                "shimmer-sweep": {
                    "0%": { backgroundPosition: "-200% center" },
                    "100%": { backgroundPosition: "200% center" },
                },
                "glow-pulse": {
                    "0%, 100%": { opacity: "0.5" },
                    "50%": { opacity: "1" },
                },
                "count-up": {
                    from: { opacity: "0", transform: "translateY(6px) scale(0.9)" },
                    to: { opacity: "1", transform: "translateY(0) scale(1)" },
                },
                "slide-up-fade": {
                    from: { opacity: "0", transform: "translateY(8px)" },
                    to: { opacity: "1", transform: "translateY(0)" },
                },
                "scale-in": {
                    from: { opacity: "0", transform: "scale(0.95)" },
                    to: { opacity: "1", transform: "scale(1)" },
                },
                "pulse-ring": {
                    "0%": { boxShadow: "0 0 0 0   hsl(var(--primary) / 0.5)" },
                    "100%": { boxShadow: "0 0 0 12px hsl(var(--primary) / 0)" },
                },
            },
            animation: {
                "accordion-down": "accordion-down 0.2s ease-out",
                "accordion-up": "accordion-up 0.2s ease-out",
                "float": "float 3s ease-in-out infinite",
                "glow-pulse": "glow-pulse 2s ease-in-out infinite",
                "count-up": "count-up 0.5s ease-out",
                "slide-up": "slide-up-fade 0.3s ease-out",
                "scale-in": "scale-in 0.2s ease-out",
                "pulse-ring": "pulse-ring 1s ease-out infinite",
                "shimmer": "shimmer-sweep 2s ease-in-out infinite",
            },
            transitionTimingFunction: {
                'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
                'in-expo': 'cubic-bezier(0.95, 0.05, 0.795, 0.035)',
                'out-expo': 'cubic-bezier(0.19, 1, 0.22, 1)',
            },
        },
    },
    plugins: [tailwindcssAnimate],
}
