module.exports = {
  preset: 'ts-jest',
  testMatch: [ "**/__tests__/**/*-test.[jt]s", "**/?(*.)+(spec|test).[jt]s?(x)" ],
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/lib/"],
  // testEnvironment: 'node',
}