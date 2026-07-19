jest.mock(
  '@react-native-community/netinfo',
  () => require('@react-native-community/netinfo/jest/netinfo-mock'),
);

// Expo's generated native-module mock intentionally implements randomUUID as
// a no-op. The application relies on UUIDs as stable entity identifiers, so
// tests need the same contract as the native and web implementations.
jest.mock('expo-crypto', () => {
  let sequence = 0;

  return {
    randomUUID: jest.fn(() => {
      sequence += 1;
      const suffix = sequence.toString(16).padStart(12, '0').slice(-12);
      return `00000000-0000-4000-8000-${suffix}`;
    }),
  };
});
