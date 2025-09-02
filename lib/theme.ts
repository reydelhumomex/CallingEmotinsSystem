import { extendTheme, ThemeConfig } from '@chakra-ui/react';

const config: ThemeConfig = {
  initialColorMode: 'light',
  useSystemColorMode: false,
};

const theme = extendTheme({
  config,
  fonts: {
    heading: `ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial`,
    body: `ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial`,
  },
  colors: {
    brand: {
      50: '#e7f1ff',
      100: '#cfe4ff',
      200: '#a4cbff',
      300: '#78b2ff',
      400: '#4d99ff',
      500: '#227fff',
      600: '#0a66e6',
      700: '#064fb3',
      800: '#053980',
      900: '#03234d',
    },
  },
  components: {
    Button: {
      baseStyle: { borderRadius: 'md' },
      defaultProps: { colorScheme: 'brand' },
    },
    Card: {
      baseStyle: {
        container: {
          borderRadius: 'lg',
          boxShadow: 'sm',
        },
      },
    },
  },
});

export default theme;

