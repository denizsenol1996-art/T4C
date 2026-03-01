import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'nl.cardatax.taxatie',
  appName: 'CardDatax Taxatie',
  webDir: 'www',
  server: {
    // In development: verbind met je lokale server
    // url: 'http://192.168.1.x:3000',
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#060810',
      showSpinner: false,
      androidSplashResourceName: 'splash',
      splashFullScreen: true,
      splashImmersive: true
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#060810'
    },
    Camera: {
      // Foto's van auto's voor taxatie
      presentationStyle: 'fullscreen'
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true
    }
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined
    }
  },
  ios: {
    contentInset: 'automatic',
    scheme: 'CardDatax'
  }
};

export default config;
