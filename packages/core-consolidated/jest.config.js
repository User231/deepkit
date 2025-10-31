module.exports = {
  displayName: '@7b/core',
  preset: '../../jest.config.js',
  testMatch: ['<rootDir>/tests/**/*.spec.ts', '<rootDir>/tests/**/*.spec.tsx'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      compiler: 'typescript'
    }]
  }
};
