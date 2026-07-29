/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
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
  			mono: ['var(--font-mono)']
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
