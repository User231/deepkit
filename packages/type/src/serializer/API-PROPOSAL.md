# Deepkit Type API Proposal

## Design Goals

1. **Fast by default** - The most common operations should be the fastest
2. **Explicit trade-offs** - Users opt-in to slower features (error collection, coercion)
3. **Benchmark parity** - Match typescript-runtime-type-benchmarks operations
4. **Backwards compatible** - Deprecate, don't break

---

## Current API Problems

```typescript
// Current: `is` does too much
is<T>(data, serializer?, errors?, type?): data is T
// - Resolves type every call
// - Generates score-based code with error collection infrastructure
// - 32% of optimal performance

// Current: `deserialize` has runtime overhead
deserialize<T>(data, {loosely?}): T
// - Runtime `loosely` check on every property
// - 73% of optimal performance
```

---

## Proposed API

### Type Guards (Validation → boolean)

```typescript
// ════════════════════════════════════════════════════════════════
// FAST TYPE GUARDS (pure && chain, no error collection)
// ════════════════════════════════════════════════════════════════

/**
 * Fast type guard. Returns true if data matches type T.
 * Ignores extra/unknown keys. No error details.
 *
 * Generated code: `return typeof s0 === "object" && ...`
 *
 * @example
 * if (is<User>(data)) {
 *   console.log(data.name); // data is User
 * }
 */
function is<T>(data: unknown, type?: ReceiveType<T>): data is T;

/**
 * Strict type guard. Returns true only if data matches type T exactly.
 * Throws/returns false on extra/unknown keys.
 *
 * @example
 * if (isStrict<User>(data)) {
 *   // data has exactly the properties of User, nothing more
 * }
 */
function isStrict<T>(data: unknown, type?: ReceiveType<T>): data is T;

/**
 * Pre-compiled type guard for repeated use.
 *
 * @example
 * const isUser = typeGuard<User>();
 * items.filter(isUser); // Fast filtering
 */
function typeGuard<T>(type?: ReceiveType<T>): (data: unknown) => data is T;

/**
 * Pre-compiled strict type guard.
 */
function typeGuardStrict<T>(type?: ReceiveType<T>): (data: unknown) => data is T;

// ════════════════════════════════════════════════════════════════
// VALIDATION WITH ERROR COLLECTION (slower, but detailed)
// ════════════════════════════════════════════════════════════════

/**
 * Validate data and collect detailed errors.
 * Use when you need to know WHY validation failed.
 *
 * @example
 * const errors: ValidationError[] = [];
 * if (!validate<User>(data, errors)) {
 *   console.log(errors); // [{path: 'email', message: 'Invalid email'}, ...]
 * }
 */
function validate<T>(data: unknown, errors?: ValidationError[], type?: ReceiveType<T>): data is T;

/**
 * Pre-compiled validator with error collection.
 */
function validator<T>(type?: ReceiveType<T>): (data: unknown, errors?: ValidationError[]) => data is T;

/**
 * Assert that data is of type T, throw ValidationError if not.
 *
 * @throws ValidationError with detailed error information
 */
function assert<T>(data: unknown, type?: ReceiveType<T>): asserts data is T;
```

### Parsing (unknown → T)

```typescript
// ════════════════════════════════════════════════════════════════
// FAST PARSING (no coercion, object literal output)
// ════════════════════════════════════════════════════════════════

/**
 * Parse unknown data to type T.
 * - NO type coercion (string "123" stays string, not converted to number)
 * - Strips unknown keys (returns new object with only declared properties)
 * - Throws on missing required or wrong types
 *
 * Generated code: `return {a: s0.a, b: s0.b, ...}`
 *
 * Use for: API input parsing, JSON parsing, untrusted data
 *
 * @example
 * const user = parse<User>(req.body);
 * // user has only User properties, extra keys stripped
 */
function parse<T>(data: unknown, type?: ReceiveType<T>): T;

/**
 * Strict parse - throws on unknown keys instead of stripping them.
 *
 * Use for: Strict API contracts where extra data indicates a bug
 */
function parseStrict<T>(data: unknown, type?: ReceiveType<T>): T;

/**
 * Pre-compiled parse function.
 */
function parseFunction<T>(type?: ReceiveType<T>): (data: unknown) => T;

/**
 * Pre-compiled strict parse function.
 */
function parseStrictFunction<T>(type?: ReceiveType<T>): (data: unknown) => T;

// ════════════════════════════════════════════════════════════════
// DESERIALIZE WITH COERCION (Deepkit's power feature)
// ════════════════════════════════════════════════════════════════

/**
 * Deserialize with type coercion.
 * - Converts compatible types: string "123" → number 123
 * - Converts ISO strings → Date objects
 * - Strips unknown keys
 *
 * Use for: Form data, query params, legacy APIs with loose typing
 *
 * @example
 * // Input: {age: "25", created: "2024-01-01T00:00:00Z"}
 * const user = deserialize<User>(data);
 * // Output: {age: 25, created: Date(...)}
 */
function deserialize<T>(data: unknown, type?: ReceiveType<T>): T;

/**
 * Deserialize + validate. Throws if validation fails after deserialization.
 *
 * Use for: When you need both coercion AND validation guarantees
 */
function cast<T>(data: unknown, type?: ReceiveType<T>): T;

/**
 * Pre-compiled deserialize function.
 */
function deserializeFunction<T>(type?: ReceiveType<T>): (data: unknown) => T;

/**
 * Pre-compiled cast function.
 */
function castFunction<T>(type?: ReceiveType<T>): (data: unknown) => T;
```

### Serialization (T → JSON)

```typescript
// ════════════════════════════════════════════════════════════════
// SERIALIZATION (unchanged, already optimal)
// ════════════════════════════════════════════════════════════════

/**
 * Serialize typed data to JSON-compatible object.
 * - Converts Date → ISO string
 * - Converts class instances → plain objects
 * - Respects @group and @exclude decorators
 */
function serialize<T>(data: T, type?: ReceiveType<T>): JSONSingle<T>;

/**
 * Pre-compiled serialize function.
 */
function serializeFunction<T>(type?: ReceiveType<T>): (data: T) => JSONSingle<T>;
```

---

## API Summary Table

| Function           | Output  | Extra Keys | Coercion | Errors  | Performance |
| ------------------ | ------- | ---------- | -------- | ------- | ----------- |
| `is<T>()`          | boolean | ignore     | no       | no      | **100%**    |
| `isStrict<T>()`    | boolean | throw      | no       | no      | ~95%        |
| `validate<T>()`    | boolean | ignore     | no       | **yes** | ~32%        |
| `parse<T>()`       | T       | strip      | no       | no      | **100%**    |
| `parseStrict<T>()` | T       | throw      | no       | no      | ~95%        |
| `deserialize<T>()` | T       | strip      | **yes**  | no      | ~73%        |
| `cast<T>()`        | T       | strip      | **yes**  | throw   | ~50%        |

---

## Mapping to Benchmarks

| Benchmark    | Deepkit Function                                 | Expected Performance |
| ------------ | ------------------------------------------------ | -------------------- |
| assertLoose  | `is<T>()` or `typeGuard<T>()`                    | 100% of optimal      |
| assertStrict | `isStrict<T>()` or `typeGuardStrict<T>()`        | ~95% of optimal      |
| parseSafe    | `parse<T>()` or `parseFunction<T>()`             | 100% of optimal      |
| parseStrict  | `parseStrict<T>()` or `parseStrictFunction<T>()` | ~95% of optimal      |

---

## Migration Guide

### Breaking Changes

**`is<T>()` signature change:**

```typescript
// OLD (v1.x)
is<T>(data, serializer?, errors?, type?): data is T

// NEW (v2.x)
is<T>(data, type?): data is T
```

### Migration Path

```typescript
// OLD: is() with error collection
const errors: ValidationError[] = [];
if (!is<User>(data, undefined, errors)) {
    console.log(errors);
}

// NEW: use validate() for error collection
const errors: ValidationError[] = [];
if (!validate<User>(data, errors)) {
    console.log(errors);
}

// OLD: is() for simple type guard
if (is<User>(data)) { ... }

// NEW: same, but now MUCH faster
if (is<User>(data)) { ... }
```

### Deprecation Strategy

```typescript
// Phase 1: Add new functions, deprecate old signature
/** @deprecated Use validate() for error collection, is() no longer accepts errors */
function is<T>(data: unknown, serializer?: Serializer, errors?: ValidationError[], type?: ReceiveType<T>): data is T;

// Phase 2: Remove deprecated overload in next major version
function is<T>(data: unknown, type?: ReceiveType<T>): data is T;
```

---

## Implementation Strategy

### Phase 1: New JIT Modes

Add new validation modes to `BuildState`:

```typescript
type ValidationMode =
  | 'fast' // Pure && chain, no errors, no score
  | 'strict' // && chain + unknown key check
  | 'full'; // Score-based with error collection (current)
```

### Phase 2: New Registries

```typescript
class Serializer {
  // Existing
  serializeRegistry: HandlerRegistry;
  deserializeRegistry: HandlerRegistry; // with coercion

  // New
  parseRegistry: HandlerRegistry; // no coercion
  typeGuardRegistry: HandlerRegistry; // pure && chain
}
```

### Phase 3: Generated Code Patterns

| Mode               | Generated Code                                                                      |
| ------------------ | ----------------------------------------------------------------------------------- |
| `is<T>()`          | `return typeof s0==="object" && s0!==null && typeof s0.a==="number" && ...`         |
| `isStrict<T>()`    | `if(Object.keys(s0).length!==N) return false; return typeof s0.a==="number" && ...` |
| `parse<T>()`       | `if(typeof s0!=="object") throw ...; return {a:s0.a, b:s0.b}`                       |
| `parseStrict<T>()` | `if(Object.keys(s0).length!==N) throw ...; return {a:s0.a, b:s0.b}`                 |
| `deserialize<T>()` | Current code with coercion                                                          |
| `validate<T>()`    | Current score-based code with error collection                                      |

---

## Advanced Options (Future)

For users who need fine-grained control:

```typescript
interface TypeGuardOptions {
  strict?: boolean; // Reject unknown keys
  coerce?: boolean; // Enable type coercion
  errors?: ValidationError[]; // Collect errors
}

// Unified function with options
function check<T>(data: unknown, options?: TypeGuardOptions, type?: ReceiveType<T>): data is T;

// But the simple functions remain the primary API
```

---

## Complete Public API (index.ts exports)

```typescript
// Type Guards
export { is, isStrict, typeGuard, typeGuardStrict } from './typeguard.js';

// Validation with errors
export { validate, validator, assert } from './validation.js';

// Parsing
export { parse, parseStrict, parseFunction, parseStrictFunction } from './parse.js';

// Deserialization (with coercion)
export { deserialize, deserializeFunction, cast, castFunction } from './deserialize.js';

// Serialization
export { serialize, serializeFunction } from './serialize.js';

// Types
export { ValidationError, ValidationErrorItem } from './validator.js';
export { SerializationOptions } from './serializer/index.js';
```
