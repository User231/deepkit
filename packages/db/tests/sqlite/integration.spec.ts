import { test } from '@jest/globals';
import { runIntegrationTests } from '@7b/db';
import { databaseFactory } from './factory.js';

runIntegrationTests(databaseFactory);

test('placeholder', async () => {
});
