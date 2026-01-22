import { BenchSuite } from '@deepkit/bench';

import { jit } from '../src/jit.js';

/**
 * Real-world JIT benchmark scenarios based on actual Deepkit package usage patterns.
 *
 * These benchmarks simulate the operations performed by:
 * - @deepkit/type (serialization, validation, type guards, change detection)
 * - @deepkit/bson (binary serialization with TypedArrays)
 * - @deepkit/injector (dependency resolution, factory functions)
 * - @deepkit/http (request parsing, parameter extraction)
 * - @deepkit/sql (row-to-entity mapping)
 * - @deepkit/workflow (state machine dispatch)
 */

// ============================================================================
// Test Data
// ============================================================================

// Entity-like object (ORM pattern)
const userEntity = {
    id: 1,
    name: 'John Doe',
    email: 'john@example.com',
    age: 30,
    createdAt: new Date('2024-01-15'),
    address: {
        street: '123 Main St',
        city: 'New York',
        country: 'USA',
    },
    roles: ['admin', 'user'],
};

// HTTP request-like object
const httpRequest = {
    method: 'POST',
    path: '/api/users/123/posts/456',
    query: { page: '1', limit: '20', sort: 'createdAt' },
    headers: {
        'content-type': 'application/json',
        authorization: 'Bearer token123',
        'x-request-id': 'req-abc-123',
    },
    body: { title: 'New Post', content: 'Hello world' },
};

// SQL row (array-based like database drivers return)
const sqlRow = [1, 'John Doe', 'john@example.com', 30, true, '2024-01-15T00:00:00Z'];

// Array of SQL rows (100 items)
const sqlRows = Array.from({ length: 100 }, (_, i) => [
    i + 1,
    `User ${i}`,
    `user${i}@example.com`,
    20 + (i % 50),
    i % 2 === 0,
    '2024-01-15T00:00:00Z',
]);

// Union type test data
const unionData = [
    { type: 'user', id: 1, name: 'John' },
    { type: 'admin', id: 2, permissions: ['read', 'write'] },
    { type: 'guest', sessionId: 'sess-123' },
];

// Snapshot comparison data (for change detection)
const snapshotOld = { id: 1, name: 'John', age: 30, active: true };
const snapshotNew = { id: 1, name: 'John', age: 31, active: true }; // age changed

// ============================================================================
// Scenario 1: @deepkit/type - Serialization with Type Transformations
// ============================================================================

const dateToString = (d: Date) => d.toISOString();
const stringToDate = (s: string) => new Date(s);

// JIT: Serialize entity with Date → string transformation
const typeSerializerJIT = jit.fnJIT(jit.arg<any>(), (ctx, input) => {
    return ctx.objFrom({
        id: input.get('id'),
        name: input.get('name'),
        email: input.get('email'),
        age: input.get('age'),
        createdAt: ctx.callExpr(dateToString, input.get('createdAt')),
        address: ctx.objFrom({
            street: input.get('address').get('street'),
            city: input.get('address').get('city'),
            country: input.get('address').get('country'),
        }),
        roles: input.get('roles'),
    });
});

const typeSerializerExec = jit.fnExec(jit.arg<any>(), (ctx, input) => {
    return ctx.objFrom({
        id: input.get('id'),
        name: input.get('name'),
        email: input.get('email'),
        age: input.get('age'),
        createdAt: ctx.callExpr(dateToString, input.get('createdAt')),
        address: ctx.objFrom({
            street: input.get('address').get('street'),
            city: input.get('address').get('city'),
            country: input.get('address').get('country'),
        }),
        roles: input.get('roles'),
    });
});

const typeSerializerBaseline = (input: any): any => {
    return {
        id: input.id,
        name: input.name,
        email: input.email,
        age: input.age,
        createdAt: dateToString(input.createdAt),
        address: {
            street: input.address.street,
            city: input.address.city,
            country: input.address.country,
        },
        roles: input.roles,
    };
};

// ============================================================================
// Scenario 2: @deepkit/type - Union Type Discrimination
// ============================================================================

const serializeUser = (u: any) => ({ kind: 'user', id: u.id, name: u.name });
const serializeAdmin = (a: any) => ({ kind: 'admin', id: a.id, perms: a.permissions });
const serializeGuest = (g: any) => ({ kind: 'guest', session: g.sessionId });

// JIT: Discriminated union serialization (like type serializer handles unions)
const unionSerializerJIT = jit.fnJIT(jit.arg<any>(), (ctx, input) => {
    const typeField = input.get('type');

    ctx.when(ctx.eq(typeField, ctx.lit('user')), () => {
        return ctx.objFrom({
            kind: ctx.lit('user'),
            id: input.get('id'),
            name: input.get('name'),
        });
    });

    ctx.when(ctx.eq(typeField, ctx.lit('admin')), () => {
        return ctx.objFrom({
            kind: ctx.lit('admin'),
            id: input.get('id'),
            perms: input.get('permissions'),
        });
    });

    // Default: guest
    return ctx.objFrom({
        kind: ctx.lit('guest'),
        session: input.get('sessionId'),
    });
});

const unionSerializerExec = jit.fnExec(jit.arg<any>(), (ctx, input) => {
    const typeField = input.get('type');

    ctx.when(ctx.eq(typeField, ctx.lit('user')), () => {
        return ctx.objFrom({
            kind: ctx.lit('user'),
            id: input.get('id'),
            name: input.get('name'),
        });
    });

    ctx.when(ctx.eq(typeField, ctx.lit('admin')), () => {
        return ctx.objFrom({
            kind: ctx.lit('admin'),
            id: input.get('id'),
            perms: input.get('permissions'),
        });
    });

    return ctx.objFrom({
        kind: ctx.lit('guest'),
        session: input.get('sessionId'),
    });
});

const unionSerializerBaseline = (input: any): any => {
    if (input.type === 'user') {
        return { kind: 'user', id: input.id, name: input.name };
    }
    if (input.type === 'admin') {
        return { kind: 'admin', id: input.id, perms: input.permissions };
    }
    return { kind: 'guest', session: input.sessionId };
};

// ============================================================================
// Scenario 3: @deepkit/type - Change Detection (Snapshot Comparison)
// ============================================================================

const props = ['id', 'name', 'age', 'active'] as const;

// JIT: Compare two snapshots and return changed fields
// Note: Both versions always return the changes object for fair comparison
const changeDetectorJIT = jit.fnJIT(jit.arg<any>(), jit.arg<any>(), (ctx, oldSnap, newSnap) => {
    const changes = ctx.let(ctx.objExpr());

    for (const prop of props) {
        const oldVal = oldSnap.get(prop);
        const newVal = newSnap.get(prop);
        ctx.when(ctx.neq(oldVal, newVal), () => {
            ctx.set(changes, prop, newVal);
        });
    }

    return changes;
});

const changeDetectorExec = jit.fnExec(jit.arg<any>(), jit.arg<any>(), (ctx, oldSnap, newSnap) => {
    const changes = ctx.let(ctx.objExpr());

    for (const prop of props) {
        const oldVal = oldSnap.get(prop);
        const newVal = newSnap.get(prop);
        ctx.when(ctx.neq(oldVal, newVal), () => {
            ctx.set(changes, prop, newVal);
        });
    }

    return changes;
});

// Generic baseline: What you'd have WITHOUT JIT - must loop over unknown properties
// This is the realistic baseline for code that uses runtime type info
const changeDetectorGenericBaseline = (oldSnap: any, newSnap: any): any => {
    const changes: any = {};
    for (const prop of props) {
        if (oldSnap[prop] !== newSnap[prop]) {
            changes[prop] = newSnap[prop];
        }
    }
    return changes;
};

// Optimal baseline: The ideal hand-written code - unrolled, type-specific
// This is the target JIT should match (impossible to achieve generically)
const changeDetectorOptimalBaseline = (oldSnap: any, newSnap: any): any => {
    const changes: any = {};
    if (oldSnap.id !== newSnap.id) changes.id = newSnap.id;
    if (oldSnap.name !== newSnap.name) changes.name = newSnap.name;
    if (oldSnap.age !== newSnap.age) changes.age = newSnap.age;
    if (oldSnap.active !== newSnap.active) changes.active = newSnap.active;
    return changes;
};

// ============================================================================
// Scenario 4: @deepkit/http - Request Parameter Extraction
// ============================================================================

// Simulates extracting path params, query params, headers from HTTP request
const pathRegex = /^\/api\/users\/(\d+)\/posts\/(\d+)$/;
const parseInt10 = (s: string) => parseInt(s, 10);

// JIT: Extract parameters from HTTP request (like request-parser.ts)
const requestParserJIT = jit.fnJIT(jit.arg<any>(), (ctx, req) => {
    const path = req.get('path');
    const query = req.get('query');
    const headers = req.get('headers');
    const body = req.get('body');

    // Extract path params via regex - use let() because match is used 3 times
    const match = ctx.let(ctx.callExpr((p: string) => pathRegex.exec(p), path));

    ctx.when(ctx.isNull(match), () => {
        return ctx.lit(null);
    });

    return ctx.objFrom({
        // Path params
        userId: ctx.callExpr(parseInt10, match.at(1)),
        postId: ctx.callExpr(parseInt10, match.at(2)),
        // Query params
        page: ctx.callExpr(parseInt10, query.get('page')),
        limit: ctx.callExpr(parseInt10, query.get('limit')),
        sort: query.get('sort'),
        // Headers
        contentType: headers.get('content-type'),
        authorization: headers.get('authorization'),
        requestId: headers.get('x-request-id'),
        // Body
        title: body.get('title'),
        content: body.get('content'),
    });
});

const requestParserExec = jit.fnExec(jit.arg<any>(), (ctx, req) => {
    const path = req.get('path');
    const query = req.get('query');
    const headers = req.get('headers');
    const body = req.get('body');

    // Use let() because match is used multiple times
    const match = ctx.let(ctx.callExpr((p: string) => pathRegex.exec(p), path));

    ctx.when(ctx.isNull(match), () => {
        return ctx.lit(null);
    });

    return ctx.objFrom({
        userId: ctx.callExpr(parseInt10, match.at(1)),
        postId: ctx.callExpr(parseInt10, match.at(2)),
        page: ctx.callExpr(parseInt10, query.get('page')),
        limit: ctx.callExpr(parseInt10, query.get('limit')),
        sort: query.get('sort'),
        contentType: headers.get('content-type'),
        authorization: headers.get('authorization'),
        requestId: headers.get('x-request-id'),
        title: body.get('title'),
        content: body.get('content'),
    });
});

const requestParserBaseline = (req: any): any => {
    const match = pathRegex.exec(req.path);
    if (match === null) return null;

    return {
        userId: parseInt10(match[1]),
        postId: parseInt10(match[2]),
        page: parseInt10(req.query.page),
        limit: parseInt10(req.query.limit),
        sort: req.query.sort,
        contentType: req.headers['content-type'],
        authorization: req.headers.authorization,
        requestId: req.headers['x-request-id'],
        title: req.body.title,
        content: req.body.content,
    };
};

// ============================================================================
// Scenario 5: @deepkit/sql - Row-to-Entity Mapping
// ============================================================================

class UserEntity {
    constructor(
        public id: number = 0,
        public name: string = '',
        public email: string = '',
        public age: number = 0,
        public active: boolean = false,
        public createdAt: Date = new Date(),
    ) {}
}

// JIT: Map SQL row array to entity (like sql-builder.ts buildConverter)
const rowMapperJIT = jit.fnJIT(jit.arg<any[]>(), (ctx, row) => {
    // Check if primary key is null (LEFT JOIN case)
    ctx.when(ctx.isNull(row.at(0)), () => {
        return ctx.lit(undefined);
    });

    const entity = ctx.let(ctx.newExpr(UserEntity));
    ctx.set(entity, 'id', row.at(0));
    ctx.set(entity, 'name', row.at(1));
    ctx.set(entity, 'email', row.at(2));
    ctx.set(entity, 'age', row.at(3));
    ctx.set(entity, 'active', row.at(4));
    ctx.set(entity, 'createdAt', ctx.callExpr(stringToDate, row.at(5)));
    return entity;
});

const rowMapperExec = jit.fnExec(jit.arg<any[]>(), (ctx, row) => {
    ctx.when(ctx.isNull(row.at(0)), () => {
        return ctx.lit(undefined);
    });

    const entity = ctx.let(ctx.newExpr(UserEntity));
    ctx.set(entity, 'id', row.at(0));
    ctx.set(entity, 'name', row.at(1));
    ctx.set(entity, 'email', row.at(2));
    ctx.set(entity, 'age', row.at(3));
    ctx.set(entity, 'active', row.at(4));
    ctx.set(entity, 'createdAt', ctx.callExpr(stringToDate, row.at(5)));
    return entity;
});

const rowMapperBaseline = (row: any[]): UserEntity | undefined => {
    if (row[0] === null) return undefined;

    const entity = new UserEntity();
    entity.id = row[0];
    entity.name = row[1];
    entity.email = row[2];
    entity.age = row[3];
    entity.active = row[4];
    entity.createdAt = stringToDate(row[5]);
    return entity;
};

// ============================================================================
// Scenario 6: @deepkit/sql - Batch Row Mapping (100 rows)
// ============================================================================

// JIT: Map array of SQL rows to entities
const batchRowMapperJIT = jit.fnJIT(jit.arg<any[][]>(), (ctx, rows) => {
    return ctx.map(rows, row => {
        const entity = ctx.let(ctx.newExpr(UserEntity));
        ctx.set(entity, 'id', row.at(0));
        ctx.set(entity, 'name', row.at(1));
        ctx.set(entity, 'email', row.at(2));
        ctx.set(entity, 'age', row.at(3));
        ctx.set(entity, 'active', row.at(4));
        ctx.set(entity, 'createdAt', ctx.callExpr(stringToDate, row.at(5)));
        return entity;
    });
});

const batchRowMapperExec = jit.fnExec(jit.arg<any[][]>(), (ctx, rows) => {
    return ctx.map(rows, row => {
        const entity = ctx.let(ctx.newExpr(UserEntity));
        ctx.set(entity, 'id', row.at(0));
        ctx.set(entity, 'name', row.at(1));
        ctx.set(entity, 'email', row.at(2));
        ctx.set(entity, 'age', row.at(3));
        ctx.set(entity, 'active', row.at(4));
        ctx.set(entity, 'createdAt', ctx.callExpr(stringToDate, row.at(5)));
        return entity;
    });
});

const batchRowMapperBaseline = (rows: any[][]): UserEntity[] => {
    return rows.map(row => {
        const entity = new UserEntity();
        entity.id = row[0];
        entity.name = row[1];
        entity.email = row[2];
        entity.age = row[3];
        entity.active = row[4];
        entity.createdAt = stringToDate(row[5]);
        return entity;
    });
};

// ============================================================================
// Scenario 7: @deepkit/injector - Dependency Factory (Simplified)
// ============================================================================

class Logger {
    log(msg: string) {
        /* noop */
    }
}
class Database {
    constructor(public logger: Logger) {}
}
class UserService {
    constructor(
        public db: Database,
        public logger: Logger,
    ) {}
}

// Simulates singleton cache check + dependency resolution
const singletonCache: Map<any, any> = new Map();
const loggerInstance = new Logger();
const dbInstance = new Database(loggerInstance);

// JIT: Factory with singleton check and dependency injection
const factoryJIT = jit.fnJIT(ctx => {
    // Singleton check
    const cached = ctx.callExpr(() => singletonCache.get(UserService));
    ctx.when(ctx.not(ctx.isNullish(cached)), () => {
        return cached;
    });

    // Create with resolved dependencies
    const instance = ctx.let(ctx.newExpr(UserService, ctx.lit(dbInstance), ctx.lit(loggerInstance)));

    // Cache it
    ctx.callExpr(() => singletonCache.set(UserService, instance));

    return instance;
});

const factoryExec = jit.fnExec(ctx => {
    const cached = ctx.callExpr(() => singletonCache.get(UserService));
    ctx.when(ctx.not(ctx.isNullish(cached)), () => {
        return cached;
    });

    const instance = ctx.let(ctx.newExpr(UserService, ctx.lit(dbInstance), ctx.lit(loggerInstance)));
    ctx.callExpr(() => singletonCache.set(UserService, instance));

    return instance;
});

const factoryBaseline = (): UserService => {
    const cached = singletonCache.get(UserService);
    if (cached !== undefined) return cached;

    const instance = new UserService(dbInstance, loggerInstance);
    singletonCache.set(UserService, instance);
    return instance;
};

// ============================================================================
// Scenario 8: @deepkit/bson - Binary Size Calculation (Simplified)
// ============================================================================

// Simulates BSON sizer that calculates byte size before allocation
const stringByteLength = (s: string) => Buffer.byteLength(s, 'utf8');

// JIT: Calculate BSON document size
const bsonSizerJIT = jit.fnJIT(jit.arg<any>(), (ctx, input) => {
    // Document overhead: 4 bytes size + 1 byte terminator
    let size = ctx.lit(5);

    // id field: 1 (type) + 3 (name "id\0") + 4 (int32)
    size = ctx.callExpr((a: number, b: number) => a + b, size, ctx.lit(8));

    // name field: 1 (type) + 5 (name "name\0") + 4 (size) + strlen + 1 (terminator)
    const nameLen = ctx.callExpr(stringByteLength, input.get('name'));
    size = ctx.callExpr((a: number, b: number, c: number) => a + b + c, size, ctx.lit(10), nameLen);

    // email field: 1 (type) + 6 (name "email\0") + 4 (size) + strlen + 1
    const emailLen = ctx.callExpr(stringByteLength, input.get('email'));
    size = ctx.callExpr((a: number, b: number, c: number) => a + b + c, size, ctx.lit(11), emailLen);

    return size;
});

const bsonSizerExec = jit.fnExec(jit.arg<any>(), (ctx, input) => {
    let size = ctx.lit(5);
    size = ctx.callExpr((a: number, b: number) => a + b, size, ctx.lit(8));

    const nameLen = ctx.callExpr(stringByteLength, input.get('name'));
    size = ctx.callExpr((a: number, b: number, c: number) => a + b + c, size, ctx.lit(10), nameLen);

    const emailLen = ctx.callExpr(stringByteLength, input.get('email'));
    size = ctx.callExpr((a: number, b: number, c: number) => a + b + c, size, ctx.lit(11), emailLen);

    return size;
});

const bsonSizerBaseline = (input: any): number => {
    let size = 5; // doc overhead
    size += 8; // id field
    size += 10 + stringByteLength(input.name); // name field
    size += 11 + stringByteLength(input.email); // email field
    return size;
};

// ============================================================================
// Scenario 9: @deepkit/workflow - State Machine Dispatch
// ============================================================================

type WorkflowState = 'pending' | 'processing' | 'completed' | 'failed';

const stateHandlers = {
    pending: () => 'handled pending',
    processing: () => 'handled processing',
    completed: () => 'handled completed',
    failed: () => 'handled failed',
};

// JIT: State machine dispatch (like workflow applier)
const stateMachineJIT = jit.fnJIT(jit.arg<WorkflowState>(), (ctx, state) => {
    ctx.when(ctx.eq(state, ctx.lit('pending')), () => {
        return ctx.callExpr(stateHandlers.pending);
    });
    ctx.when(ctx.eq(state, ctx.lit('processing')), () => {
        return ctx.callExpr(stateHandlers.processing);
    });
    ctx.when(ctx.eq(state, ctx.lit('completed')), () => {
        return ctx.callExpr(stateHandlers.completed);
    });
    ctx.when(ctx.eq(state, ctx.lit('failed')), () => {
        return ctx.callExpr(stateHandlers.failed);
    });
    return ctx.lit('unknown state');
});

const stateMachineExec = jit.fnExec(jit.arg<WorkflowState>(), (ctx, state) => {
    ctx.when(ctx.eq(state, ctx.lit('pending')), () => {
        return ctx.callExpr(stateHandlers.pending);
    });
    ctx.when(ctx.eq(state, ctx.lit('processing')), () => {
        return ctx.callExpr(stateHandlers.processing);
    });
    ctx.when(ctx.eq(state, ctx.lit('completed')), () => {
        return ctx.callExpr(stateHandlers.completed);
    });
    ctx.when(ctx.eq(state, ctx.lit('failed')), () => {
        return ctx.callExpr(stateHandlers.failed);
    });
    return ctx.lit('unknown state');
});

const stateMachineBaseline = (state: WorkflowState): string => {
    switch (state) {
        case 'pending':
            return stateHandlers.pending();
        case 'processing':
            return stateHandlers.processing();
        case 'completed':
            return stateHandlers.completed();
        case 'failed':
            return stateHandlers.failed();
        default:
            return 'unknown state';
    }
};

// ============================================================================
// Run Benchmarks
// ============================================================================

async function main() {
    console.log('Real-World JIT Benchmark Scenarios\n');
    console.log('Simulating actual Deepkit package patterns.\n');

    // Clear singleton cache between runs
    singletonCache.clear();

    // Type serialization with transformations
    const typeSer = new BenchSuite('@deepkit/type: Entity Serialization (Date transform)', 1, true);
    typeSer.add('baseline', () => typeSerializerBaseline(userEntity));
    typeSer.add('jit.fnJIT', () => typeSerializerJIT(userEntity));
    typeSer.add('jit.fnExec', () => typeSerializerExec(userEntity));
    await typeSer.runAsync();

    // Union discrimination
    const unionSer = new BenchSuite('@deepkit/type: Union Discrimination (3 types)', 1, true);
    unionSer.add('baseline', () => unionData.map(unionSerializerBaseline));
    unionSer.add('jit.fnJIT', () => unionData.map(unionSerializerJIT));
    unionSer.add('jit.fnExec', () => unionData.map(unionSerializerExec));
    await unionSer.runAsync();

    // Change detection - shows JIT's real value: matching optimal hand-written code
    // Generic: what runtime type handling must do (loop over unknown props)
    // JIT: generates optimal unrolled code from type info
    // Optimal: ideal hand-written code (the target JIT should match)
    const changeDet = new BenchSuite('@deepkit/type: Change Detection (4 props)', 1, true);
    changeDet.add('generic-baseline', () => changeDetectorGenericBaseline(snapshotOld, snapshotNew));
    changeDet.add('optimal-baseline', () => changeDetectorOptimalBaseline(snapshotOld, snapshotNew));
    changeDet.add('jit.fnJIT', () => changeDetectorJIT(snapshotOld, snapshotNew));
    changeDet.add('jit.fnExec', () => changeDetectorExec(snapshotOld, snapshotNew));
    await changeDet.runAsync();

    // HTTP request parsing
    const httpParse = new BenchSuite('@deepkit/http: Request Parameter Extraction', 1, true);
    httpParse.add('baseline', () => requestParserBaseline(httpRequest));
    httpParse.add('jit.fnJIT', () => requestParserJIT(httpRequest));
    httpParse.add('jit.fnExec', () => requestParserExec(httpRequest));
    await httpParse.runAsync();

    // Single row mapping
    const rowMap = new BenchSuite('@deepkit/sql: Row-to-Entity (single row)', 1, true);
    rowMap.add('baseline', () => rowMapperBaseline(sqlRow));
    rowMap.add('jit.fnJIT', () => rowMapperJIT(sqlRow));
    rowMap.add('jit.fnExec', () => rowMapperExec(sqlRow));
    await rowMap.runAsync();

    // Batch row mapping
    const batchMap = new BenchSuite('@deepkit/sql: Row-to-Entity (100 rows)', 1, true);
    batchMap.add('baseline', () => batchRowMapperBaseline(sqlRows));
    batchMap.add('jit.fnJIT', () => batchRowMapperJIT(sqlRows));
    batchMap.add('jit.fnExec', () => batchRowMapperExec(sqlRows));
    await batchMap.runAsync();

    // Factory with singleton
    singletonCache.clear();
    const factory = new BenchSuite('@deepkit/injector: Factory (singleton check)', 1, true);
    factory.add('baseline', () => {
        singletonCache.clear();
        return factoryBaseline();
    });
    factory.add('jit.fnJIT', () => {
        singletonCache.clear();
        return factoryJIT();
    });
    factory.add('jit.fnExec', () => {
        singletonCache.clear();
        return factoryExec();
    });
    await factory.runAsync();

    // BSON sizing
    const bsonSize = new BenchSuite('@deepkit/bson: Document Size Calculation', 1, true);
    bsonSize.add('baseline', () => bsonSizerBaseline(userEntity));
    bsonSize.add('jit.fnJIT', () => bsonSizerJIT(userEntity));
    bsonSize.add('jit.fnExec', () => bsonSizerExec(userEntity));
    await bsonSize.runAsync();

    // State machine
    const states: WorkflowState[] = ['pending', 'processing', 'completed', 'failed'];
    const stateDispatch = new BenchSuite('@deepkit/workflow: State Machine Dispatch', 1, true);
    stateDispatch.add('baseline', () => states.map(stateMachineBaseline));
    stateDispatch.add('jit.fnJIT', () => states.map(stateMachineJIT));
    stateDispatch.add('jit.fnExec', () => states.map(stateMachineExec));
    await stateDispatch.runAsync();
}

main().catch(console.error);
