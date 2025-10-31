import { serveOrmBrowser } from '@d7/orm-browser';
import { SQLiteDatabase } from './src/database.js';

const db = new SQLiteDatabase(':memory:');
db.migrate().then(() => {
    return serveOrmBrowser([db]);
});
