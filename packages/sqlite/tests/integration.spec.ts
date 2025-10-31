import { test } from '@jest/globals';
import { runIntegrationTests } from '@d7/orm-integration';
import { databaseFactory } from './factory.js';

runIntegrationTests(databaseFactory);

test('placeholder', async () => {
});
