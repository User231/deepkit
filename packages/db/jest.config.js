module.exports = {
  displayName: '@7b/db',
  preset: '../../jest.config.js',
  testMatch: ['<rootDir>/tests/**/*.spec.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      compiler: 'typescript'
    }]
  }
};
