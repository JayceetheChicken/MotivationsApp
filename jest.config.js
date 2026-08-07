module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Screen tests render the full navigation and store tree. The first render in
  // a suite also pays for the module graph, which exceeds Jest's 5 s default on
  // a loaded CI runner. The tests themselves do no waiting.
  testTimeout: 20_000,
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|expo-router|react-navigation|@react-navigation/.*|react-native-svg)',
  ],
};
