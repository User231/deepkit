# Serializer Rewrite Design Document

## Overview

Rewrite `@deepkit/type` serialization using `jit.fn()` from `@deepkit/core` instead of `CompilerContext`. This enables CSP compliance while maintaining performance.

**CRITICAL RULE:** Never use `CompilerContext`. If `jit.fn()` seems insufficient, extend `@deepkit/core/src/jit.ts` with new primitives.

### Philosophy: Clean Break, No Migration

This is a **complete rewrite**, not a migration:

- **No legacy code** - Don't preserve old patterns or maintain backward compatibility within `@deepkit/type`
- **No migration path** - The old serializer will be replaced entirely, not wrapped or gradually deprecated
- **Downstream packages will break** - `@deepkit/bson`, `@deepkit/sql`, `@deepkit/mongo`, etc. depend on `@deepkit/type` internals. They WILL break. That's OK.
- **Fix downstream later** - First make `@deepkit/type` perfect, then update dependent packages to the new API

**However:** The use cases of downstream packages (BSON binary serialization, SQL type mapping, etc.) must inform the API design. We're not ignoring their needs - we're building the right abstractions first, then adapting them.

### Before/After Example

```typescript
// ❌ OLD (CompilerContext) - This is what exists in packages/type/src/serializer.ts
const compiler = new CompilerContext();
compiler.context.set('isString', (v: any) => typeof v === 'string');
compiler.context.set('ValidationError', ValidationError);
const code = `
    if (!isString(data)) throw new ValidationError('Expected string');
    return data;
`;
return compiler.build(code, 'data');

// ✅ NEW (jit.fn()) - Rewrite to this
return jit.fn(jit.arg<any>(), (ctx, data) => {
    ctx.when(ctx.not(ctx.isType(data, 'string')), () => {
        ctx.call(throwValidationError, ctx.lit('Expected string'));
    });
    return data;
});
```

```typescript
// ❌ OLD - Tracking state with template strings
let code = 'var hasChanges = false;\n';
for (const prop of props) {
    code += `if (old.${prop} !== new.${prop}) hasChanges = true;\n`;
}
code += 'return hasChanges;';
return compiler.build(code, 'old', 'new');

// ✅ NEW - Using var_/setVar/getVar
return jit.fn(jit.arg<any>(), jit.arg<any>(), (ctx, oldObj, newObj) => {
    const hasChanges = ctx.var_(false);
    for (const prop of props) {
        ctx.when(ctx.neq(oldObj.get(prop), newObj.get(prop)), () => {
            ctx.setVar(hasChanges, ctx.lit(true));
        });
    }
    return ctx.getVar(hasChanges);
});
```

**Key insight**: The old code accumulates template strings. The new code calls ctx methods that either generate code (JIT mode) or execute directly (Exec mode).

---

## Use Cases That Must Be Supported

### 1. HTTP Request Parsing
- Query strings: `?limit=123&active=true` → all values are strings
- URL params: `/user/123` → string "123" must become number
- Form data: multipart fields are strings
- Requires `loosely: true` for string-to-type coercion

### 2. CLI Argument Parsing
- All arguments are strings from shell
- `--count 5` → "5" must become number 5
- `--verbose` → flag becomes boolean true
- Uses default loosely mode

### 3. JSON Serialization/Deserialization
- Standard JSON types
- Date as ISO string ↔ Date object
- Binary as base64 string ↔ ArrayBuffer/TypedArray

### 4. BSON Binary Serialization
- Completely separate from JSON
- Needs multiple registries: sizer, serialize, deserialize
- Own type guards checking BSON type markers
- Supports ObjectId, Binary, 64-bit integers

### 5. Validation
- `is()` uses strict mode (specificality = 1 only)
- `validate()` collects errors with paths
- Validation annotations: `MinLength`, `Pattern`, `Positive`, etc.
- Custom validators via `Validate<typeof fn>`

---

## Specificality System (CRITICAL)

Type guards are organized by "specificality" levels that determine when they activate:

| Level | Name | Purpose | Example |
|-------|------|---------|---------|
| -0.9 | Very Loose | Boolean from strings | `"true"` → `true`, `"1"` → `true` |
| -0.5 | Loose | Numeric strings | `"123"` → `123` (number/bigint) |
| 0.5 | JSON Priority | ISO date over string | `"2021-01-01"` → Date (not string) |
| 1 | Exact | JS typeof/instanceof | `typeof v === 'number'` |
| 1.5 | Fallback | Timestamp to Date | `1637781902866` → Date |
| 2 | Late Fallback | null↔undefined, RegExp | `"/pattern/"` → RegExp |
| 10 | Very Late | Binary from base64 | base64 string → Uint8Array |
| 20 | Last Resort | `any` in unions | Matches anything |
| 50 | Ultimate | String accepts all | Everything can be string |

**Activation Rules:**
- `specificality < 0`: Only when `options.loosely !== false`
- `specificality === 1`: Used by `is()` with `validation: 'strict'`
- `specificality < 1`: Skipped during serialization
- All levels used during deserialization

**Union Resolution:**
1. Guards sorted by specificality (lowest first)
2. Try each guard until one matches
3. Higher specificity = more specific match wins

**Example: `number | string` with input `"123"`**
- Loose mode ON: specificality -0.5 matches → number `123`
- Loose mode OFF: specificality 1 matches string → string `"123"`

---

## Architecture

### Slots as Expression Trees

**Key insight:** Slots are not values - they are expression trees. When a handler returns a Slot, it's returning an expression that will be inlined into the generated code.

```typescript
// Handler for string type guard - returns expression tree
function stringGuard(type: TypeString, input: Slot, ctx: Context, state: BuildState): Slot<boolean> {
    return ctx.isType(input, 'string');  // Returns Slot representing: typeof input === 'string'
}

// Handler for number guard with loose mode
function numberLooseGuard(type: TypeNumber, input: Slot, ctx: Context, state: BuildState): Slot<boolean> {
    return ctx.and(
        ctx.isType(input, 'string'),
        ctx.call(isNumeric, input)  // isNumeric is external fn, but guard EXPRESSION is inlined
    );
}

// In union handling - guards are EXPRESSIONS, not function calls
for (const member of type.types) {
    // guardExpr is a Slot (expression tree), NOT a function
    const guardExpr = getGuardHandler(member)(member, input, ctx, state);

    // Using the Slot inlines the expression
    ctx.when(guardExpr, () => {
        ctx.setVar(result, state.build(member, input));
    });
}
```

Generated code - all expressions inlined:
```javascript
// No guard function calls - pure expressions
if (typeof s0 === 'string') {
    result = s0;
}
if (typeof s0 === 'number') {
    result = s0;
}
if (typeof s0 === 'string' && isNumeric_0(s0)) {  // Only helper fn called
    result = Number_0(s0);
}
```

The only function calls in generated code are to helper functions that MUST be called (like `isNumeric`, `Number` constructor, etc.), not to guard/handler wrappers.

### Inlining Strategy

**Inline by default** - nested types are embedded in one function:

```typescript
// GOOD: One function, types inlined
jit.fn(jit.arg<User>(), (ctx, input) => {
    const result = ctx.obj();
    // name: string - inline
    ctx.set(result, 'name', serializeString(input.get('name'), ctx));
    // address: Address - inline (depth 1)
    const addr = ctx.obj();
    ctx.set(addr, 'street', serializeString(input.get('address').get('street'), ctx));
    ctx.set(result, 'address', addr);
    return result;
});

// BAD: Separate functions (call overhead)
const addressFn = jit.fn(...);
const userFn = jit.fn((ctx, input) => {
    ctx.set(result, 'address', ctx.call(addressFn, ...)); // SLOW
});
```

**Extract to separate function ONLY when:**
1. Circular reference detected (Type A → Type B → Type A)
2. Depth exceeds limit (default: 3 levels)

### Core Types

```typescript
// Type handler signature
type TypeHandler<T extends Type = Type> = (
    type: T,
    input: Slot,
    ctx: Context,
    state: BuildState
) => Slot;

// Hook for wrapping handlers (validators use post-hook)
type TypeHook = (
    type: Type,
    input: Slot,
    ctx: Context,
    state: BuildState,
    next: () => Slot
) => Slot;
```

### HandlerRegistry

```typescript
class HandlerRegistry {
    private kindHandlers = new Map<ReflectionKind, TypeHandler[]>();
    private classHandlers = new Map<ClassType, TypeHandler[]>();
    private annotationHandlers: Array<{
        predicate: (type: Type) => boolean;
        handler: TypeHandler;
    }> = [];
    private preHooks: TypeHook[] = [];
    private postHooks: TypeHook[] = [];

    // Registration by kind
    register(kind: ReflectionKind, handler: TypeHandler): this;
    prepend(kind: ReflectionKind, handler: TypeHandler): this;
    append(kind: ReflectionKind, handler: TypeHandler): this;

    // Registration by class (Date, Set, Map, Uint8Array, etc.)
    registerClass(classType: ClassType, handler: TypeHandler): this;
    registerBinary(handler: TypeHandler): this;

    // Registration by annotation (UUID, Reference, Embedded, etc.)
    addDecorator(predicate: (type: Type) => boolean, handler: TypeHandler): this;

    // Hooks for wrapping
    addPreHook(hook: TypeHook): this;
    addPostHook(hook: TypeHook): this;

    // Execute handlers for type
    build(type: Type, input: Slot, ctx: Context, state: BuildState): Slot;
}
```

### TypeGuardRegistry

```typescript
class TypeGuardRegistry {
    private levels = new Map<number, HandlerRegistry>();

    // Get or create registry for specificality level
    getRegistry(specificality: number): HandlerRegistry;

    // Convenience registration
    register(specificality: number, kind: ReflectionKind, handler: TypeHandler): this;
    registerClass(specificality: number, classType: ClassType, handler: TypeHandler): this;
    registerBinary(specificality: number, handler: TypeHandler): this;

    // Returns levels sorted by specificality (lowest first)
    getSortedLevels(): Array<[number, HandlerRegistry]>;
}
```

### BuildState

```typescript
interface BuildState {
    readonly direction: 'serialize' | 'deserialize' | 'validate';
    readonly serializer: Serializer;
    readonly ctx: Context;
    readonly options: Slot<SerializationOptions>;

    // Validation mode
    readonly validation: 'strict' | 'loose' | undefined;

    // Inlining control
    readonly depth: number;
    readonly maxDepth: number;  // default 3
    readonly typeStack: Set<Type>;  // circular detection

    // Path tracking for errors
    readonly pathSegments: (string | Slot<string>)[];
    pathSlot(): Slot<string>;

    // Build nested type (decides inline vs extract)
    build(type: Type, input: Slot): Slot;

    // Fork for nesting
    forProperty(name: string): BuildState;
    forIndex(index: Slot<number>): BuildState;

    // Helpers
    isLoose(): Slot<boolean>;      // options.loosely !== false
    isStrictValidation(): boolean; // validation === 'strict'

    // Error handling
    throw_(type: Type, value: Slot, message?: string): void;
    addValidationError(code: string, message: string, value: Slot): void;

    // External values
    extern<T>(value: T): Slot<T>;
}
```

### Serializer Class

```typescript
class Serializer {
    readonly name: string;

    // Standard registries
    readonly serializeRegistry = new HandlerRegistry();
    readonly deserializeRegistry = new HandlerRegistry();
    readonly typeGuards = new TypeGuardRegistry();

    // Named registries for extensions (BSON needs: sizer, bsonSerialize, bsonDeserialize)
    readonly namedRegistries = new Map<string, HandlerRegistry>();

    constructor(name: string = 'json') {
        this.name = name;
        this.registerDefaults();
    }

    // Build JIT functions
    buildSerializer<T>(type: Type): (data: T, options?: SerializationOptions) => any;
    buildDeserializer<T>(type: Type): (data: any, options?: SerializationOptions) => T;
    buildValidator<T>(type: Type): (data: any, errors?: ValidationErrorItem[]) => boolean;

    // Extension points
    createRegistry(name: string): HandlerRegistry;
    getRegistry(name: string): HandlerRegistry | undefined;

    // Override in subclasses
    protected registerDefaults(): void;

    // Control behavior
    setExplicitUndefined(type: Type, state: BuildState): boolean;
}

export const serializer = new Serializer('json');
```

---

## Union Handling

### Priority Order

1. **Discriminated Union (O(1))** - Property with distinct literal values per member
2. **Literal Union (O(1))** - All members are literals, use Set.has()
3. **Primitive Union** - typeof chain
4. **Scored Union** - Type guard scoring with specificality

### Discriminated Union Detection

```typescript
function detectDiscriminator(type: TypeUnion): DiscriminatorInfo | undefined {
    // Find property where all members have distinct literal values
    const candidates = new Map<string, Map<any, Type>>();

    for (const member of type.types) {
        if (member.kind !== ReflectionKind.objectLiteral &&
            member.kind !== ReflectionKind.class) continue;

        for (const prop of resolveTypeMembers(member)) {
            if (prop.type.kind !== ReflectionKind.literal) continue;
            const name = String(prop.name);
            if (!candidates.has(name)) candidates.set(name, new Map());
            candidates.get(name)!.set(prop.type.literal, member);
        }
    }

    // Find discriminator with unique value per member
    for (const [prop, valueMap] of candidates) {
        if (valueMap.size === type.types.length) {
            return { property: prop, valueToMember: valueMap };
        }
    }
    return undefined;
}
```

### Discriminated Union Build

```typescript
function buildDiscriminatedUnion(
    type: TypeUnion,
    disc: DiscriminatorInfo,
    input: Slot,
    ctx: Context,
    state: BuildState
): Slot {
    const discValue = input.get(disc.property);
    const result = ctx.var_<any>(undefined);

    const cases: Array<[any, () => void]> = [];
    for (const [literal, memberType] of disc.valueToMember) {
        cases.push([literal, () => {
            ctx.setVar(result, state.build(memberType, input));
        }]);
    }

    ctx.switch_(discValue, cases, () => {
        state.throw_(type, input, 'No matching discriminator');
    });

    return ctx.getVar(result);
}
```

### Scored Union Build

```typescript
function buildScoredUnion(
    type: TypeUnion,
    input: Slot,
    ctx: Context,
    state: BuildState
): Slot {
    const result = ctx.var_<any>(undefined);
    const matched = ctx.var_(false);
    const bestScore = ctx.var_(0);

    const levels = state.serializer.typeGuards.getSortedLevels();

    for (const [specificality, registry] of levels) {
        // Skip negative specificality unless loose mode
        if (specificality < 0) {
            ctx.when(ctx.not(state.isLoose()), () => { /* skip */ });
            continue;
        }

        // Skip non-1 for strict validation
        if (state.isStrictValidation() && specificality !== 1) continue;

        // Skip negative for serialization
        if (state.direction === 'serialize' && specificality < 1) continue;

        for (const member of type.types) {
            const guard = buildTypeGuard(member, registry, ctx, state);
            const score = ctx.call(guard, input);

            ctx.when(ctx.gt(score, ctx.getVar(bestScore)), () => {
                ctx.setVar(bestScore, score);
                ctx.setVar(result, state.build(member, input));
                ctx.setVar(matched, ctx.lit(true));
            });
        }
    }

    ctx.when(ctx.not(ctx.getVar(matched)), () => {
        state.throw_(type, input);
    });

    return ctx.getVar(result);
}
```

---

## File Structure

```
packages/type/src/
├── serializer/
│   ├── serializer.ts         # Serializer class, public API
│   ├── registry.ts           # HandlerRegistry, TypeGuardRegistry
│   ├── state.ts              # BuildState implementation
│   ├── builder.ts            # jit.fn() integration, function building
│   ├── handlers.ts           # All type handlers (primitives, objects, etc.)
│   ├── union.ts              # Union handling (discriminated, literal, scored)
│   ├── validation.ts         # Validator hook, ValidationErrorItem
│   ├── naming.ts             # NamingStrategy
│   └── errors.ts             # SerializationError
├── change-detector.ts        # REWRITE with jit.fn()
├── snapshot.ts               # REWRITE with jit.fn()
├── path.ts                   # REWRITE with jit.fn()
└── ...
```

**Note:** No `index.ts` files. Imports use explicit paths like `import { Serializer } from './serializer/serializer.js'`.

---

## jit.ts Changes Required

### 1. Named Variables Instead of Array Indices (CRITICAL)

Current jit.ts uses array indices for external values:
```typescript
// Current (BAD - poor debuggability, unclear code)
const extIdx = this.externs.push(fn) - 1;
this.code += `e[${extIdx}](${args})`;
// Generates: e[0](s1), e[1](s2), etc.
```

Must change to named parameters like CompilerContext:
```typescript
// New (GOOD - readable, debuggable)
const name = this.reserveName('Date');
this.externs.set(name, fn);
this.code += `${name}(${args})`;
// Generates: Date_0(s1), isNumeric_0(s2), etc.

// compile() becomes:
new Function(...this.externs.keys(), code)(...this.externs.values());
```

For undefined initial values (monomorphic optimization):
```typescript
// Use _context.varName pattern like CompilerContext
reserveVariable(name: string, value?: any): string {
    const freeName = this.reserveName(name);
    if (value === undefined) {
        return '_context.' + freeName;  // Monomorphic reference
    } else {
        this.externs.set(freeName, value);
        return freeName;
    }
}
```

### 2. Slots as Expression Trees

Slots represent expressions, not values. When we compose Slots, we build an expression tree that gets inlined:

```typescript
// Type guard returns expression tree (Slot), not a function
const isString = ctx.isType(input, 'string');  // Slot: typeof s0 === 'string'
const isNumber = ctx.isType(input, 'number');  // Slot: typeof s0 === 'number'

// Compose expressions - all inlined, no function calls
ctx.when(ctx.or(isString, isNumber), () => {
    // ...
});

// Generated code - pure expressions:
if (typeof s0 === 'string' || typeof s0 === 'number') {
    // ...
}
```

### 3. New Primitives Needed

| Primitive | Purpose | JIT Output |
|-----------|---------|------------|
| `ctx.throw_(error: Slot)` | Throw exception | `throw ${expr};` |
| `ctx.forIn(obj, (key, value) => void)` | Object iteration | `for(var k in obj){...}` |
| `ctx.instanceof_(value, ctor)` | instanceof check | `${value} instanceof ${ctor}` |

---

## Handler Examples

### Primitive with Specificality

```typescript
// In registerDefaults():

// String - exact match (specificality 1)
this.typeGuards.register(1, ReflectionKind.string, (type, input, ctx, state) => {
    return ctx.isType(input, 'string');
});

// String - ultimate fallback (specificality 50)
this.typeGuards.register(50, ReflectionKind.string, (type, input, ctx, state) => {
    return ctx.and(
        ctx.not(ctx.isNullish(input)),
        ctx.lit(true)
    );
});

// Number - exact match (specificality 1)
this.typeGuards.register(1, ReflectionKind.number, (type, input, ctx, state) => {
    return ctx.isType(input, 'number');
});

// Number - loose from string (specificality -0.5)
this.typeGuards.register(-0.5, ReflectionKind.number, (type, input, ctx, state) => {
    const isNumericString = ctx.call(isNumeric, input);
    return ctx.and(ctx.isType(input, 'string'), isNumericString);
});

// Boolean - exact match (specificality 1)
this.typeGuards.register(1, ReflectionKind.boolean, (type, input, ctx, state) => {
    return ctx.isType(input, 'boolean');
});

// Boolean - loose from string/number (specificality -0.9)
this.typeGuards.register(-0.9, ReflectionKind.boolean, (type, input, ctx, state) => {
    return ctx.or(
        ctx.eq(input, ctx.lit(1)),
        ctx.eq(input, ctx.lit('1')),
        ctx.eq(input, ctx.lit(0)),
        ctx.eq(input, ctx.lit('true')),
        ctx.eq(input, ctx.lit('false'))
    );
});

// Date - exact match (specificality 1)
this.typeGuards.registerClass(1, Date, (type, input, ctx, state) => {
    return ctx.isInstance(input, Date);
});

// Date - ISO string (specificality 0.5, beats raw string)
this.typeGuards.registerClass(0.5, Date, (type, input, ctx, state) => {
    return ctx.and(
        ctx.isType(input, 'string'),
        ctx.call((s: string) => new Date(s).toString() !== 'Invalid Date', input)
    );
});

// Date - timestamp number (specificality 1.5, fallback)
this.typeGuards.registerClass(1.5, Date, (type, input, ctx, state) => {
    return ctx.isType(input, 'number');
});
```

### Object Literal Handler

```typescript
function handleObjectLiteral(
    type: TypeObjectLiteral,
    input: Slot,
    ctx: Context,
    state: BuildState
): Slot {
    // Type check
    ctx.when(ctx.not(ctx.isType(input, 'object')), () => {
        state.throw_(type, input);
    });
    ctx.when(ctx.isNull(input), () => {
        state.throw_(type, input);
    });

    const result = ctx.obj();

    for (const member of resolveTypeMembers(type)) {
        if (!isPropertyMember(member)) continue;

        const name = memberNameToString(member.name);
        const propState = state.forProperty(name);

        ctx.when(ctx.has(input, name), () => {
            const propInput = input.get(name);

            // Handle null/undefined
            ctx.cond([
                [ctx.isNullish(propInput), () => {
                    if (isNullable(member)) {
                        ctx.set(result, name, ctx.lit(null));
                    } else if (!isOptional(member)) {
                        propState.throw_(member.type, propInput);
                    }
                }]
            ], () => {
                // INLINE nested build
                const converted = propState.build(member.type, propInput);
                ctx.set(result, name, converted);
            });
        }, () => {
            // Property missing
            if (!isOptional(member) && !hasDefaultValue(member)) {
                propState.addValidationError('required', 'Required property missing', ctx.lit(undefined));
            }
        });
    }

    // Index signatures
    handleIndexSignatures(type, input, result, ctx, state);

    return result;
}
```

### Validation Post-Hook

```typescript
// Registered as post-hook on typeGuards.getRegistry(1)
function validationHook(
    type: Type,
    input: Slot,
    ctx: Context,
    state: BuildState,
    next: () => Slot
): Slot {
    // Run type check first
    const typeResult = next();

    // If type check passed, run validators
    const annotations = validationAnnotation.getAnnotations(type);
    if (annotations.length === 0) return typeResult;

    const valid = ctx.var_(typeResult);

    for (const validation of annotations) {
        const { name, args } = validation;

        if (name === 'function') {
            // Custom validator
            const validatorFn = state.extern(args[0].function);
            const error = ctx.call(validatorFn, input, state.extern(type));
            ctx.when(error, () => {
                ctx.setVar(valid, ctx.lit(false));
                state.addValidationError(
                    ctx.get(error, 'code'),
                    ctx.get(error, 'message'),
                    input
                );
            });
        } else {
            // Built-in validator
            const validator = validators[name];
            if (validator) {
                const validatorFn = state.extern(validator(...args));
                const error = ctx.call(validatorFn, input);
                ctx.when(error, () => {
                    ctx.setVar(valid, ctx.lit(false));
                    state.addValidationError(
                        ctx.get(error, 'code'),
                        ctx.get(error, 'message'),
                        input
                    );
                });
            }
        }
    }

    return ctx.getVar(valid);
}
```

---

## Implementation Order

1. **Extend jit.ts** - Add `throw_`, `forIn`, `cond`, `concat`
2. **serializer/registry.ts** - HandlerRegistry, TypeGuardRegistry
3. **serializer/state.ts** - BuildState with inline/extract logic
4. **serializer/builder.ts** - jit.fn() integration
5. **serializer/handlers.ts** - All type handlers with specificality
6. **serializer/union.ts** - Union strategies
7. **serializer/validation.ts** - Validator hook
8. **serializer/naming.ts** - NamingStrategy
9. **serializer/errors.ts** - SerializationError
10. **serializer/serializer.ts** - Serializer class, public API
11. **path.ts** - Rewrite
12. **snapshot.ts** - Rewrite
13. **change-detector.ts** - Rewrite

---

## Public API Preservation

These exports must remain for external packages:

```typescript
// Classes
export class Serializer { ... }
export class SerializationError extends DeepkitError { ... }
export class NamingStrategy { ... }
export const underscoreNamingStrategy: NamingStrategy;
export const serializer: Serializer;

// Types
export type SerializeFunction<T, R> = (data: T, options?: SerializationOptions) => R;
export interface SerializationOptions { groups?, groupsExclude?, loosely? }
export type Guard<T> = (data: any, state?) => data is T;

// Functions (may have different implementation)
export function getSerializeFunction(...): SerializeFunction;
export function createSerializeFunction(...): SerializeFunction;
export function createTypeGuardFunction(...): Guard<any> | undefined;
```

**Note:** Internal classes like `TemplateState`, `TemplateRegistry`, `ContainerAccessor` will be deleted. External packages (BSON, SQL, Mongo) will be updated separately after `@deepkit/type` is complete.

---

## Verification

```bash
# Build
npm run tsc

# Test
npm run test packages/type/

# Benchmark (must be < 10% regression)
cd packages/type && node --import @deepkit/run benchmarks/serializer.ts
```
