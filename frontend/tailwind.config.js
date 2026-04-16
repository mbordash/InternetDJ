// tailwind.config.js
module.exports = {
    content: [
        './src/**/*.{js,jsx,ts,tsx}', // Ensure all source files are scanned
    ],
    theme: {
        extend: {
            colors: {
                'primary-brand': {
                    DEFAULT: '#008dcb', // Optional: Sets a default shade
                    50: '#e0f3fd',
                    100: '#bce6f9',
                    200: '#98d9f5',
                    300: '#73cbf0',
                    400: '#4fbded',
                    500: '#008dcb', // Your exact color
                    600: '#0078b5',
                    700: '#00629d',
                    800: '#004d85',
                    900: '#00376d',
                    950: '#002143',
                },
            },
            position: {
                static: 'static', // Define position-static
            },
        },
    },
    plugins: [
        require('@tailwindcss/typography'),
    ],
};