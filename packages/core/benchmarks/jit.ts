import { BenchSuite } from '@deepkit/bench';

import { jit } from '../src/jit.js';

// ============================================================================
// Test Data
// ============================================================================

const simpleObject = { id: 1, name: 'John', email: 'john@example.com' };

const mediumObject = {
    id: 1,
    name: 'John Doe',
    email: 'john@example.com',
    age: 30,
    active: true,
    score: 95.5,
    tags: ['developer', 'typescript', 'nodejs'],
    address: {
        street: '123 Main St',
        city: 'New York',
        zip: '10001',
        country: 'USA',
    },
};

const largeObject = {
    id: 1,
    uuid: '550e8400-e29b-41d4-a716-446655440000',
    name: 'John Doe',
    email: 'john.doe@example.com',
    phone: '+1-555-123-4567',
    age: 30,
    active: true,
    verified: true,
    score: 95.5,
    rating: 4.8,
    balance: 1234.56,
    tags: ['developer', 'typescript', 'nodejs', 'react', 'graphql'],
    roles: ['admin', 'user', 'moderator'],
    permissions: ['read', 'write', 'delete', 'admin'],
    address: {
        street: '123 Main St',
        city: 'New York',
        state: 'NY',
        zip: '10001',
        country: 'USA',
        coordinates: { lat: 40.7128, lng: -74.006 },
    },
    company: {
        name: 'Tech Corp',
        industry: 'Technology',
        employees: 500,
        public: true,
    },
    metadata: {
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-06-15T12:30:00Z',
        version: 42,
        source: 'api',
    },
};

const arrayOfObjects = Array.from({ length: 100 }, (_, i) => ({
    id: i,
    name: `User ${i}`,
    active: i % 2 === 0,
}));

// ============================================================================
// Benchmark 1: Simple Property Copy (3 properties)
// ============================================================================

const simpleProps = ['id', 'name', 'email'];

// JIT mode
const simpleSerializerJIT = jit.fnJIT(jit.arg<any>(), (ctx, input) => {
    const output = ctx.obj();
    for (const prop of simpleProps) {
        ctx.set(output, prop, ctx.get(input, prop));
    }
    return output;
});

// Exec mode
const simpleSerializerExec = jit.fnExec(jit.arg<any>(), (ctx, input) => {
    const output = ctx.obj();
    for (const prop of simpleProps) {
        ctx.set(output, prop, ctx.get(input, prop));
    }
    return output;
});

// Baseline: hand-written
function simpleSerializerBaseline(input: any): any {
    return {
        id: input.id,
        name: input.name,
        email: input.email,
    };
}

// ============================================================================
// Benchmark 2: Medium Object (10 properties, nested)
// ============================================================================

const mediumProps = ['id', 'name', 'email', 'age', 'active', 'score', 'tags'];
const addressProps = ['street', 'city', 'zip', 'country'];

// JIT mode
const mediumSerializerJIT = jit.fnJIT(jit.arg<any>(), (ctx, input) => {
    const output = ctx.obj();
    for (const prop of mediumProps) {
        ctx.set(output, prop, ctx.get(input, prop));
    }
    // Nested address
    const addr = ctx.obj();
    const inputAddr = ctx.get(input, 'address');
    for (const prop of addressProps) {
        ctx.set(addr, prop, ctx.get(inputAddr, prop));
    }
    ctx.set(output, 'address', addr);
    return output;
});

// Exec mode
const mediumSerializerExec = jit.fnExec(jit.arg<any>(), (ctx, input) => {
    const output = ctx.obj();
    for (const prop of mediumProps) {
        ctx.set(output, prop, ctx.get(input, prop));
    }
    const addr = ctx.obj();
    const inputAddr = ctx.get(input, 'address');
    for (const prop of addressProps) {
        ctx.set(addr, prop, ctx.get(inputAddr, prop));
    }
    ctx.set(output, 'address', addr);
    return output;
});

// Baseline
function mediumSerializerBaseline(input: any): any {
    return {
        id: input.id,
        name: input.name,
        email: input.email,
        age: input.age,
        active: input.active,
        score: input.score,
        tags: input.tags,
        address: {
            street: input.address.street,
            city: input.address.city,
            zip: input.address.zip,
            country: input.address.country,
        },
    };
}

// ============================================================================
// Benchmark 3: Large Object (20+ properties, deeply nested)
// ============================================================================

const largeTopProps = [
    'id',
    'uuid',
    'name',
    'email',
    'phone',
    'age',
    'active',
    'verified',
    'score',
    'rating',
    'balance',
    'tags',
    'roles',
    'permissions',
];
const largeAddressProps = ['street', 'city', 'state', 'zip', 'country'];
const coordProps = ['lat', 'lng'];
const companyProps = ['name', 'industry', 'employees', 'public'];
const metaProps = ['createdAt', 'updatedAt', 'version', 'source'];

// JIT mode
const largeSerializerJIT = jit.fnJIT(jit.arg<any>(), (ctx, input) => {
    const output = ctx.obj();

    for (const prop of largeTopProps) {
        ctx.set(output, prop, ctx.get(input, prop));
    }

    // address with nested coordinates
    const addr = ctx.obj();
    const inputAddr = ctx.get(input, 'address');
    for (const prop of largeAddressProps) {
        ctx.set(addr, prop, ctx.get(inputAddr, prop));
    }
    const coords = ctx.obj();
    const inputCoords = ctx.get(inputAddr, 'coordinates');
    for (const prop of coordProps) {
        ctx.set(coords, prop, ctx.get(inputCoords, prop));
    }
    ctx.set(addr, 'coordinates', coords);
    ctx.set(output, 'address', addr);

    // company
    const company = ctx.obj();
    const inputCompany = ctx.get(input, 'company');
    for (const prop of companyProps) {
        ctx.set(company, prop, ctx.get(inputCompany, prop));
    }
    ctx.set(output, 'company', company);

    // metadata
    const meta = ctx.obj();
    const inputMeta = ctx.get(input, 'metadata');
    for (const prop of metaProps) {
        ctx.set(meta, prop, ctx.get(inputMeta, prop));
    }
    ctx.set(output, 'metadata', meta);

    return output;
});

// Exec mode
const largeSerializerExec = jit.fnExec(jit.arg<any>(), (ctx, input) => {
    const output = ctx.obj();

    for (const prop of largeTopProps) {
        ctx.set(output, prop, ctx.get(input, prop));
    }

    const addr = ctx.obj();
    const inputAddr = ctx.get(input, 'address');
    for (const prop of largeAddressProps) {
        ctx.set(addr, prop, ctx.get(inputAddr, prop));
    }
    const coords = ctx.obj();
    const inputCoords = ctx.get(inputAddr, 'coordinates');
    for (const prop of coordProps) {
        ctx.set(coords, prop, ctx.get(inputCoords, prop));
    }
    ctx.set(addr, 'coordinates', coords);
    ctx.set(output, 'address', addr);

    const company = ctx.obj();
    const inputCompany = ctx.get(input, 'company');
    for (const prop of companyProps) {
        ctx.set(company, prop, ctx.get(inputCompany, prop));
    }
    ctx.set(output, 'company', company);

    const meta = ctx.obj();
    const inputMeta = ctx.get(input, 'metadata');
    for (const prop of metaProps) {
        ctx.set(meta, prop, ctx.get(inputMeta, prop));
    }
    ctx.set(output, 'metadata', meta);

    return output;
});

// Baseline
function largeSerializerBaseline(input: any): any {
    return {
        id: input.id,
        uuid: input.uuid,
        name: input.name,
        email: input.email,
        phone: input.phone,
        age: input.age,
        active: input.active,
        verified: input.verified,
        score: input.score,
        rating: input.rating,
        balance: input.balance,
        tags: input.tags,
        roles: input.roles,
        permissions: input.permissions,
        address: {
            street: input.address.street,
            city: input.address.city,
            state: input.address.state,
            zip: input.address.zip,
            country: input.address.country,
            coordinates: {
                lat: input.address.coordinates.lat,
                lng: input.address.coordinates.lng,
            },
        },
        company: {
            name: input.company.name,
            industry: input.company.industry,
            employees: input.company.employees,
            public: input.company.public,
        },
        metadata: {
            createdAt: input.metadata.createdAt,
            updatedAt: input.metadata.updatedAt,
            version: input.metadata.version,
            source: input.metadata.source,
        },
    };
}

// ============================================================================
// Benchmark 4: Array Iteration (100 items)
// ============================================================================

const itemProps = ['id', 'name', 'active'];

// JIT mode
const arraySerializerJIT = jit.fnJIT(jit.arg<any[]>(), (ctx, input) => {
    const output = ctx.arr();
    ctx.loop(input, elem => {
        const item = ctx.obj();
        for (const prop of itemProps) {
            ctx.set(item, prop, ctx.get(elem, prop));
        }
        ctx.push(output, item);
    });
    return output;
});

// Exec mode
const arraySerializerExec = jit.fnExec(jit.arg<any[]>(), (ctx, input) => {
    const output = ctx.arr();
    ctx.loop(input, elem => {
        const item = ctx.obj();
        for (const prop of itemProps) {
            ctx.set(item, prop, ctx.get(elem, prop));
        }
        ctx.push(output, item);
    });
    return output;
});

// Baseline
function arraySerializerBaseline(input: any[]): any[] {
    return input.map(item => ({
        id: item.id,
        name: item.name,
        active: item.active,
    }));
}

// ============================================================================
// Benchmark 5: Validation with conditionals
// ============================================================================

const isNonEmpty = (v: any) => typeof v === 'string' && v.length > 0;
const isPositive = (v: any) => typeof v === 'number' && v > 0;
const isEmail = (v: any) => typeof v === 'string' && v.includes('@');

const validationRules = [
    { prop: 'name', check: isNonEmpty, msg: 'name required' },
    { prop: 'email', check: isEmail, msg: 'invalid email' },
    { prop: 'id', check: isPositive, msg: 'id must be positive' },
];

// JIT mode
const validatorJIT = jit.fnJIT(jit.arg<any>(), (ctx, input) => {
    const errors = ctx.arr();
    for (const rule of validationRules) {
        const value = ctx.get(input, rule.prop);
        const valid = ctx.call(rule.check, value);
        ctx.when(ctx.not(valid), () => {
            ctx.push(errors, ctx.lit(rule.msg));
        });
    }
    return errors;
});

// Exec mode
const validatorExec = jit.fnExec(jit.arg<any>(), (ctx, input) => {
    const errors = ctx.arr();
    for (const rule of validationRules) {
        const value = ctx.get(input, rule.prop);
        const valid = ctx.call(rule.check, value);
        ctx.when(ctx.not(valid), () => {
            ctx.push(errors, ctx.lit(rule.msg));
        });
    }
    return errors;
});

// Baseline
function validatorBaseline(input: any): string[] {
    const errors: string[] = [];
    for (const rule of validationRules) {
        if (!rule.check(input[rule.prop])) {
            errors.push(rule.msg);
        }
    }
    return errors;
}

// ============================================================================
// Benchmark 6: Type checking with guards
// ============================================================================

// JIT mode
const typeGuardJIT = jit.fnJIT(jit.arg<any>(), (ctx, input) => {
    ctx.when(ctx.isNullish(input), () => {
        return ctx.lit(false);
    });
    ctx.when(ctx.not(ctx.isType(input, 'object')), () => {
        return ctx.lit(false);
    });
    ctx.when(ctx.not(ctx.has(input, 'id')), () => {
        return ctx.lit(false);
    });
    ctx.when(ctx.not(ctx.isType(ctx.get(input, 'id'), 'number')), () => {
        return ctx.lit(false);
    });
    ctx.when(ctx.not(ctx.has(input, 'name')), () => {
        return ctx.lit(false);
    });
    ctx.when(ctx.not(ctx.isType(ctx.get(input, 'name'), 'string')), () => {
        return ctx.lit(false);
    });
    return ctx.lit(true);
});

// Exec mode
const typeGuardExec = jit.fnExec(jit.arg<any>(), (ctx, input) => {
    ctx.when(ctx.isNullish(input), () => {
        return ctx.lit(false);
    });
    ctx.when(ctx.not(ctx.isType(input, 'object')), () => {
        return ctx.lit(false);
    });
    ctx.when(ctx.not(ctx.has(input, 'id')), () => {
        return ctx.lit(false);
    });
    ctx.when(ctx.not(ctx.isType(ctx.get(input, 'id'), 'number')), () => {
        return ctx.lit(false);
    });
    ctx.when(ctx.not(ctx.has(input, 'name')), () => {
        return ctx.lit(false);
    });
    ctx.when(ctx.not(ctx.isType(ctx.get(input, 'name'), 'string')), () => {
        return ctx.lit(false);
    });
    return ctx.lit(true);
});

// Baseline
function typeGuardBaseline(input: any): boolean {
    if (input == null) return false;
    if (typeof input !== 'object') return false;
    if (!('id' in input)) return false;
    if (typeof input.id !== 'number') return false;
    if (!('name' in input)) return false;
    if (typeof input.name !== 'string') return false;
    return true;
}

// ============================================================================
// Run Benchmarks
// ============================================================================

async function main() {
    console.log('JIT vs Exec Mode Performance Comparison\n');
    console.log('Each benchmark runs for 1 second per variant.\n');

    // Simple serialization
    const simple = new BenchSuite('Simple Object (3 props)', 1, true);
    simple.add('baseline (hand-written)', () => simpleSerializerBaseline(simpleObject));
    simple.add('jit.fnJIT', () => simpleSerializerJIT(simpleObject));
    simple.add('jit.fnExec', () => simpleSerializerExec(simpleObject));
    await simple.runAsync();

    // Medium serialization
    const medium = new BenchSuite('Medium Object (10 props, nested)', 1, true);
    medium.add('baseline (hand-written)', () => mediumSerializerBaseline(mediumObject));
    medium.add('jit.fnJIT', () => mediumSerializerJIT(mediumObject));
    medium.add('jit.fnExec', () => mediumSerializerExec(mediumObject));
    await medium.runAsync();

    // Large serialization
    const large = new BenchSuite('Large Object (20+ props, deep nesting)', 1, true);
    large.add('baseline (hand-written)', () => largeSerializerBaseline(largeObject));
    large.add('jit.fnJIT', () => largeSerializerJIT(largeObject));
    large.add('jit.fnExec', () => largeSerializerExec(largeObject));
    await large.runAsync();

    // Array iteration
    const array = new BenchSuite('Array of 100 Objects', 1, true);
    array.add('baseline (hand-written)', () => arraySerializerBaseline(arrayOfObjects));
    array.add('jit.fnJIT', () => arraySerializerJIT(arrayOfObjects));
    array.add('jit.fnExec', () => arraySerializerExec(arrayOfObjects));
    await array.runAsync();

    // Validation
    const validation = new BenchSuite('Validation (3 rules with conditionals)', 1, true);
    validation.add('baseline (hand-written)', () => validatorBaseline(simpleObject));
    validation.add('jit.fnJIT', () => validatorJIT(simpleObject));
    validation.add('jit.fnExec', () => validatorExec(simpleObject));
    await validation.runAsync();

    // Type guard
    const typeGuard = new BenchSuite('Type Guard (6 checks)', 1, true);
    typeGuard.add('baseline (hand-written)', () => typeGuardBaseline(simpleObject));
    typeGuard.add('jit.fnJIT', () => typeGuardJIT(simpleObject));
    typeGuard.add('jit.fnExec', () => typeGuardExec(simpleObject));
    await typeGuard.runAsync();
}

main().catch(console.error);
