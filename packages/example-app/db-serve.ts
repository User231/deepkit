import { serveOrmBrowser } from '@7b/ui';
import { SQLiteDatabase } from './src/database.js';

const db = new SQLiteDatabase(':memory:');
db.migrate().then(() => {
    return serveOrmBrowser([db]);
});
