# Serializer Optimization TODO

## Current Issues with Generated Serialize Code

For a simple class like:
```typescript
class SmallModel {
    ready?: boolean;
    tags: string[] = [];
    priority: number = 0;
    constructor(public id: number, public name: string) {}
}
```

The generated code has these inefficiencies:

### 1. Unnecessary `in` checks
```javascript
if (("id" in s0)) { ... }
```
**Problem**: For serialize direction, we're operating on a known class instance. Properties exist or have defaults - no need to check.

**Fix**: Skip `in` checks for serialize direction on class/object types with known shape.

### 2. Identity map for primitive arrays
```javascript
s0.tags.map(s6 => s6)
```
**Problem**: Creates a new array by mapping each element to itself. Wasteful for primitive arrays (`string[]`, `number[]`, `boolean[]`).

**Fix**: Use `s0.tags` directly (or `.slice()` if copy is required). Only use `.map()` when element transformation is actually needed.

### 3. `{c: value}` wrapper pattern
```javascript
var s5 = {c: []};
// ... later
s5.c = result;
```
**Problem**: Unnecessary object allocations for intermediate values. Should use simple variables.

**Fix**: Use `ctx.let()` / `ctx.var()` to create simple variables, not wrapper objects.

### 4. Incremental object building instead of object literal
```javascript
var s4 = {};
s4.ready = s0.ready;
s4.tags = s0.tags;
// ...
```
**Problem**: Building object incrementally is slower than returning an object literal.

**Fix**: Use `ctx.objLit()` to generate `return { id: s0.id, name: s0.name, ... }` directly.

### 5. Unnecessary `unpopulatedSymbol` check
```javascript
if (((!(s0.tags === const_0)) && isArray_0(s0.tags))) { ... }
```
**Problem**: `const_0` is `unpopulatedSymbol` for ORM relations. Regular arrays don't need this check.

**Fix**: Only add unpopulated check for arrays that are BackReference or have relation annotations.

## Ideal Generated Code Target

```javascript
function serialize(s0) {
    return {
        id: s0.id,
        name: s0.name,
        ready: s0.ready ?? null,
        tags: s0.tags,
        priority: s0.priority
    };
}
```

~10 lines instead of ~50 lines. Direct property mapping with minimal overhead.

## Implementation Notes

- `ctx.objLit(entries)` should generate object literal syntax
- Serialize direction should trust input shape (no `in` checks)
- Primitive arrays: direct reference or `.slice()`
- Object arrays: `.map()` only when element transformation needed
- Nullable handling: only when type includes `null` or `undefined`
