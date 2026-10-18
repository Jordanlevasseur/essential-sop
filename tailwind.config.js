/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		borderRadius: {
  			/* Design System V1.0 radius scale. Base --radius = 8px (cards).
  			   md = 6px (buttons/inputs/icon containers), sm = 4px (badges/chips),
  			   micro = 2px (indicators), panel = 10px, dialog = 12px. */
  			micro: '2px',
  			sm: 'calc(var(--radius) - 4px)',
  			md: 'calc(var(--radius) - 2px)',
  			lg: 'var(--radius)',
  			xl: '8px',
  			'2xl': '10px',
  			'3xl': '12px',
  			panel: '10px',
  			dialog: '12px'
  			},
  		fontSize: {
  			/* Design System V1.0 type scale. 14px is intentionally absent.
  			   text-sm = 15px (standard body), text-base = 16px (profile-adjacent
  			   defaults), headings: text-lg 18 / text-xl 22 / text-2xl 28.
  			   All rem-based to preserve accessibility text scaling. */
  			xs: ['0.75rem', { lineHeight: '1rem' }],
  			sm: ['0.9375rem', { lineHeight: '1.45rem' }],
  			base: ['0.9375rem', { lineHeight: '1.5rem' }],
  			desc: ['0.8125rem', { lineHeight: '1.35rem' }],
  			lg: ['1.125rem', { lineHeight: '1.6rem' }],
  			xl: ['1.375rem', { lineHeight: '1.75rem' }],
  			'2xl': ['1.75rem', { lineHeight: '2.05rem' }],
  			'3xl': ['1.875rem', { lineHeight: '2.15rem' }]
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			// App semantic colors
  			'app-bg': 'hsl(var(--app-bg))',
  			'app-surface': 'hsl(var(--app-surface))',
  			'app-elevated': 'hsl(var(--app-elevated))',
  			'app-card': 'hsl(var(--app-card))',
  			'app-input': 'hsl(var(--app-input-bg))',
  			'app-border': 'hsl(var(--app-border))',
  			'app-divider': 'hsl(var(--app-divider))',
  			'app-text': 'hsl(var(--app-text-primary))',
  			'app-text-2': 'hsl(var(--app-text-secondary))',
  			'app-text-muted': 'hsl(var(--app-text-muted))',
  			'app-text-disabled': 'hsl(var(--app-text-disabled))',
  			'app-heading': 'hsl(var(--app-heading))',
  			'app-accent': 'hsl(var(--app-accent))',
  			'app-accent-text': 'hsl(var(--app-accent-text))',
  			'app-success': 'hsl(var(--app-success))',
  			'app-success-bg': 'hsl(var(--app-success-bg))',
  			'app-warning': 'hsl(var(--app-warning))',
  			'app-warning-bg': 'hsl(var(--app-warning-bg))',
  			'app-danger': 'hsl(var(--app-danger))',
  			'app-danger-bg': 'hsl(var(--app-danger-bg))',
  			'app-info': 'hsl(var(--app-info))',
  			'app-info-bg': 'hsl(var(--app-info-bg))',
  			'app-inactive': 'hsl(var(--app-inactive))',
  			'app-inactive-bg': 'hsl(var(--app-inactive-bg))',
  			'app-highlight': 'hsl(var(--app-highlight))',
  			'app-disabled': 'hsl(var(--app-disabled-bg))',
  			'app-nav': 'hsl(var(--app-nav-bg))',
  			'app-nav-active': 'hsl(var(--app-nav-active))',
  			'app-nav-inactive': 'hsl(var(--app-nav-inactive))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		fontFamily: {
  			heading: ['var(--font-heading)'],
  			body: ['var(--font-body)'],
  			display: ['var(--font-display)'],
  			mono: ['var(--font-mono)'],
  			sans: ['var(--font-body)']
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}
