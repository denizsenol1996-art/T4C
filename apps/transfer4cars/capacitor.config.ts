import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.transfer4cars.app',
  appName: 'Transfer4Cars',
  webDir: 'www',
  server: {
    // In development: verbind met je lokale server
    // url: 'http://192.168.1.x:3000',
    // In productie: gebruik de ingebouwde web bestanden
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
    scheme: 'Transfer4Cars'
  }
};

export default config;
