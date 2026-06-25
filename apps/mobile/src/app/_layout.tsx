import { RegistryProvider } from '@effect/atom-react';
import { serverUrlAtom } from '@turborepo-effect-starter/client-runtime';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const serverUrl = process.env.EXPO_PUBLIC_SERVER_URL;

export default function RootLayout() {
  return (
    <RegistryProvider initialValues={[[serverUrlAtom, serverUrl]]}>
      <SafeAreaProvider>
        <Stack />
      </SafeAreaProvider>
    </RegistryProvider>
  );
}
