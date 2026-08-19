/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import {
    GraphQLEnumType,
    GraphQLInputObjectType,
    GraphQLInputType,
    GraphQLInterfaceType,
    GraphQLObjectType,
    GraphQLOutputType,
    GraphQLScalarType,
    GraphQLSchema,
    GraphQLUnionType,
    isEnumType,
    isInputObjectType,
    isInterfaceType,
    isListType,
    isNonNullType,
    isObjectType,
    isScalarType,
    isUnionType,
} from 'graphql';

import { ReflectionClass, ReflectionKind, Type, TypeEnum, TypeLiteral, stringifyType } from '@deepkit/type';

/**
 * Structural compatibility between runtime TypeScript types and a fixed
 * GraphQL schema — the contract-first inverse of schema generation.
 *
 * A resolver's declared RETURN type is checked covariantly against the SDL
 * field it claims (may narrow, must never produce a value the schema cannot
 * serialize: a missing non-null field, a string outside an enum, a member an
 * abstract type cannot dispatch). A resolver's PARAMETERS are checked
 * contravariantly against the SDL arguments (must accept every value the
 * coercion layer can deliver: explicit nulls on nullable inputs, every member
 * of an enum, every declared input field). Both directions return plain error
 * strings — the caller decides that they refuse a boot.
 */
export interface CompatCheckOptions {
    schema: GraphQLSchema;
    /**
     * `${TypeName}.${fieldName}` entries that a registered field resolver
     * answers — exempt from the property-coverage requirement on returned
     * objects, because the default property lookup is not what runs there.
     */
    coveredFields?: ReadonlySet<string>;
}

const STRING_SCALARS = new Set(['String', 'ID']);
const NUMBER_SCALARS = new Set(['Int', 'Float']);

// ─── Small type-model helpers ────────────────────────────────

function unionMembers(type: Type): Type[] {
    return type.kind === ReflectionKind.union ? type.types : [type];
}

function isNullish(type: Type): boolean {
    return type.kind === ReflectionKind.null || type.kind === ReflectionKind.undefined;
}

function admits(type: Type, kind: ReflectionKind.null | ReflectionKind.undefined): boolean {
    return unionMembers(type).some(member => member.kind === kind);
}

function nonNullishMembers(type: Type): Type[] {
    return unionMembers(type).filter(member => !isNullish(member));
}

/** The literal string values of a literal or a union of literals, else undefined. */
function literalStrings(type: Type): string[] | undefined {
    const members = unionMembers(type);
    const literals: string[] = [];
    for (const member of members) {
        if (member.kind !== ReflectionKind.literal || typeof (member as TypeLiteral).literal !== 'string') {
            return undefined;
        }
        literals.push((member as TypeLiteral).literal as string);
    }
    return literals;
}

function describe(type: Type): string {
    try {
        return stringifyType(type);
    } catch {
        return `(kind ${ReflectionKind[type.kind]})`;
    }
}

interface Member {
    name: string;
    type: Type;
    optional: boolean;
}

/** The named members of a class/object-literal type, inherited included. */
function members(type: Type): Member[] | undefined {
    if (type.kind !== ReflectionKind.class && type.kind !== ReflectionKind.objectLiteral) return undefined;
    const reflection = ReflectionClass.from(type);
    return reflection.getProperties().map(property => ({
        name: String(property.name),
        type: property.type,
        optional: property.isOptional(),
    }));
}

function typenameOf(objectMembers: Member[]): string | undefined {
    const property = objectMembers.find(member => member.name === '__typename');
    if (!property) return undefined;
    const literals = literalStrings(property.type);
    return literals && literals.length === 1 ? literals[0] : undefined;
}

/** Cycle guard: one entry per (TS type object, direction:GraphQL type name). */
type Seen = WeakMap<object, Set<string>>;

function alreadySeen(seen: Seen, type: Type, key: string): boolean {
    let keys = seen.get(type);
    if (!keys) seen.set(type, (keys = new Set()));
    if (keys.has(key)) return true;
    keys.add(key);
    return false;
}

// ─── Output (return types): covariant ────────────────────────

export function checkOutputCompatibility(
    type: Type,
    gql: GraphQLOutputType,
    where: string,
    options: CompatCheckOptions,
): string[] {
    return checkOutput(unwrapPromise(type), gql, where, options, new WeakMap());
}

function unwrapPromise(type: Type): Type {
    return type.kind === ReflectionKind.promise ? type.type : type;
}

function checkOutput(
    type: Type,
    gql: GraphQLOutputType,
    where: string,
    options: CompatCheckOptions,
    seen: Seen,
): string[] {
    // `never` produces no value at all — the bottom type satisfies every
    // output position (its canonical use: `members: never[]` for a list that
    // is deliberately always empty).
    if (type.kind === ReflectionKind.never) return [];

    if (type.kind === ReflectionKind.any || type.kind === ReflectionKind.unknown) {
        return [`${where}: declared as '${describe(type)}' — an output type must be concrete to be checkable.`];
    }

    if (isNonNullType(gql)) {
        if (admits(type, ReflectionKind.null) || admits(type, ReflectionKind.undefined)) {
            return [`${where}: '${describe(type)}' admits null/undefined, but the schema says ${String(gql)}.`];
        }
        return checkOutput(type, gql.ofType, where, options, seen);
    }

    // Nullable schema position: strip the nullish members and check the rest.
    const remaining = nonNullishMembers(type);
    if (remaining.length === 0) return []; // always null — legal for a nullable field
    const inner: Type =
        remaining.length === unionMembers(type).length
            ? type
            : remaining.length === 1
              ? remaining[0]
              : { ...(type as Type & { kind: ReflectionKind.union }), types: remaining };

    if (isListType(gql)) {
        if (inner.kind !== ReflectionKind.array) {
            return [`${where}: schema says ${String(gql)}, but '${describe(inner)}' is not an array.`];
        }
        return checkOutput(inner.type, gql.ofType, `${where}[]`, options, seen);
    }

    if (isScalarType(gql)) return checkOutputScalar(inner, gql, where);
    if (isEnumType(gql)) return checkOutputEnum(inner, gql, where);

    if (isObjectType(gql)) {
        const errors: string[] = [];
        for (const member of unionMembers(inner)) {
            errors.push(...checkOutputObject(member, gql, where, options, seen));
        }
        return errors;
    }

    if (isInterfaceType(gql) || isUnionType(gql)) {
        return checkOutputAbstract(inner, gql, where, options, seen);
    }

    return [`${where}: unsupported schema type ${String(gql)}.`];
}

function checkOutputScalar(type: Type, gql: GraphQLScalarType, where: string): string[] {
    const mismatch = (expected: string) => [
        `${where}: schema says ${gql.name}, but the declared type is '${describe(type)}' (expected ${expected}).`,
    ];
    if (STRING_SCALARS.has(gql.name)) {
        const ok = unionMembers(type).every(
            member =>
                member.kind === ReflectionKind.string ||
                member.kind === ReflectionKind.templateLiteral ||
                (member.kind === ReflectionKind.literal && typeof (member as TypeLiteral).literal === 'string'),
        );
        return ok ? [] : mismatch('a string');
    }
    if (NUMBER_SCALARS.has(gql.name)) {
        const ok = unionMembers(type).every(
            member =>
                member.kind === ReflectionKind.number ||
                (member.kind === ReflectionKind.literal && typeof (member as TypeLiteral).literal === 'number'),
        );
        return ok ? [] : mismatch('a number');
    }
    if (gql.name === 'Boolean') {
        const ok = unionMembers(type).every(
            member =>
                member.kind === ReflectionKind.boolean ||
                (member.kind === ReflectionKind.literal && typeof (member as TypeLiteral).literal === 'boolean'),
        );
        return ok ? [] : mismatch('a boolean');
    }
    return []; // custom scalar — its serialization is its own business
}

function checkOutputEnum(type: Type, gql: GraphQLEnumType, where: string): string[] {
    const allowed = new Set(gql.getValues().map(value => value.name));
    const literals =
        literalStrings(type) ??
        (type.kind === ReflectionKind.enum
            ? (type as TypeEnum).values.filter((value): value is string => typeof value === 'string')
            : undefined);
    if (!literals || (type.kind === ReflectionKind.enum && literals.length !== (type as TypeEnum).values.length)) {
        return [
            `${where}: schema says enum ${gql.name} — declare the literal union ` +
                `${[...allowed].map(v => `'${v}'`).join(' | ')} (or a subset), not '${describe(type)}'.`,
        ];
    }
    const outside = literals.filter(literal => !allowed.has(literal));
    return outside.length ? [`${where}: '${outside.join("', '")}' is not a value of enum ${gql.name}.`] : [];
}

function checkOutputObject(
    type: Type,
    gql: GraphQLObjectType,
    where: string,
    options: CompatCheckOptions,
    seen: Seen,
): string[] {
    const objectMembers = members(type);
    if (!objectMembers) {
        return [`${where}: schema says ${gql.name}, but '${describe(type)}' is not an object type.`];
    }
    if (alreadySeen(seen, type, `out:${gql.name}`)) return [];

    const errors: string[] = [];

    const typename = objectMembers.find(member => member.name === '__typename');
    if (typename) {
        const literal = typenameOf(objectMembers);
        if (literal !== gql.name) {
            errors.push(
                `${where}: __typename is '${literal ?? describe(typename.type)}' but the schema type is ${gql.name}.`,
            );
        }
    }

    for (const [fieldName, field] of Object.entries(gql.getFields())) {
        if (options.coveredFields?.has(`${gql.name}.${fieldName}`)) continue;
        const fieldWhere = `${where}.${fieldName}`;
        const property = objectMembers.find(member => member.name === fieldName);
        const required = isNonNullType(field.type);
        if (!property) {
            if (required) {
                errors.push(
                    `${fieldWhere}: ${gql.name}.${fieldName} is ${String(field.type)} but the declared type has no ` +
                        `such property — a selected field would resolve to null. Add it (or a @graphql.field() resolver).`,
                );
            }
            continue;
        }
        if (property.optional && required) {
            errors.push(`${fieldWhere}: the property is optional but the schema says ${String(field.type)}.`);
            continue;
        }
        errors.push(...checkOutput(property.type, field.type, fieldWhere, options, seen));
    }
    return errors;
}

function checkOutputAbstract(
    type: Type,
    gql: GraphQLInterfaceType | GraphQLUnionType,
    where: string,
    options: CompatCheckOptions,
    seen: Seen,
): string[] {
    const possible = new Map(options.schema.getPossibleTypes(gql).map(object => [object.name, object]));
    const errors: string[] = [];
    for (const member of unionMembers(type)) {
        const memberList = members(member);
        const typename = memberList && typenameOf(memberList);
        if (!typename) {
            errors.push(
                `${where}: ${gql.name} is abstract — every returned object needs a __typename ` +
                    `string literal naming one of: ${[...possible.keys()].join(', ')}. ` +
                    `'${describe(member)}' has none.`,
            );
            continue;
        }
        const concrete = possible.get(typename);
        if (!concrete) {
            errors.push(`${where}: __typename '${typename}' is not a possible type of ${gql.name}.`);
            continue;
        }
        errors.push(...checkOutputObject(member, concrete, where, options, seen));
    }
    return errors;
}

// ─── Input (parameters): contravariant ───────────────────────

/**
 * Checks one input position: the declared TS type must ACCEPT every value the
 * schema's coercion can deliver there. `optional`/`hasDefault` describe the
 * position: an omitted nullable argument never reaches the resolver as a key,
 * so without a schema default the TS side must admit undefined; an explicit
 * null is always deliverable on a nullable position, so null must be admitted
 * regardless of defaults.
 */
export function checkInputCompatibility(
    type: Type,
    gql: GraphQLInputType,
    where: string,
    options: CompatCheckOptions,
    position: { optional: boolean; hasDefault: boolean } = { optional: false, hasDefault: false },
): string[] {
    return checkInputPosition(type, position.optional, gql, position.hasDefault, where, options, new WeakMap());
}

function checkInputPosition(
    type: Type,
    tsOptional: boolean,
    gql: GraphQLInputType,
    hasDefault: boolean,
    where: string,
    options: CompatCheckOptions,
    seen: Seen,
): string[] {
    if (type.kind === ReflectionKind.any || type.kind === ReflectionKind.unknown) return [];

    if (isNonNullType(gql)) {
        return checkInputNamed(type, gql.ofType, where, options, seen);
    }

    const errors: string[] = [];
    if (!admits(type, ReflectionKind.null)) {
        errors.push(
            `${where}: ${String(gql)} is nullable — a client can send an explicit null, so the declared ` +
                `type must admit null ('${describe(type)}' does not).`,
        );
    }
    if (!hasDefault && !tsOptional && !admits(type, ReflectionKind.undefined)) {
        errors.push(
            `${where}: ${String(gql)} can be omitted (no schema default) — declare the parameter/property ` +
                `optional or admit undefined.`,
        );
    }
    const remaining = nonNullishMembers(type);
    if (remaining.length === 0) return errors;
    const inner: Type =
        remaining.length === 1
            ? remaining[0]
            : remaining.length === unionMembers(type).length
              ? type
              : { ...(type as Type & { kind: ReflectionKind.union }), types: remaining };
    errors.push(...checkInputNamed(inner, gql, options ? where : where, options, seen));
    return errors;
}

function checkInputNamed(
    type: Type,
    gql: GraphQLInputType,
    where: string,
    options: CompatCheckOptions,
    seen: Seen,
): string[] {
    if (type.kind === ReflectionKind.any || type.kind === ReflectionKind.unknown) return [];
    if (isNonNullType(gql)) return checkInputNamed(type, gql.ofType, where, options, seen);

    if (isListType(gql)) {
        if (type.kind !== ReflectionKind.array) {
            return [`${where}: schema delivers ${String(gql)}, but '${describe(type)}' is not an array.`];
        }
        // List coercion wraps a bare value into a single-element list, so the
        // element position behaves like a non-null-checked inner position.
        return checkInputPosition(type.type, false, gql.ofType, true, `${where}[]`, options, seen);
    }

    if (isScalarType(gql)) return checkInputScalar(type, gql, where);
    if (isEnumType(gql)) return checkInputEnum(type, gql, where);
    if (isInputObjectType(gql)) return checkInputObject(type, gql, where, options, seen);

    return [`${where}: unsupported schema input type ${String(gql)}.`];
}

function checkInputScalar(type: Type, gql: GraphQLScalarType, where: string): string[] {
    const mismatch = (delivers: string) => [
        `${where}: schema delivers ${delivers}, but '${describe(type)}' cannot accept every such value.`,
    ];
    if (STRING_SCALARS.has(gql.name)) {
        return type.kind === ReflectionKind.string ? [] : mismatch(`${gql.name} (any string)`);
    }
    if (NUMBER_SCALARS.has(gql.name)) {
        return type.kind === ReflectionKind.number ? [] : mismatch(`${gql.name} (any number)`);
    }
    if (gql.name === 'Boolean') {
        return type.kind === ReflectionKind.boolean ? [] : mismatch('Boolean');
    }
    return []; // custom scalar — opaque
}

function checkInputEnum(type: Type, gql: GraphQLEnumType, where: string): string[] {
    if (type.kind === ReflectionKind.string) return [];
    const names = gql.getValues().map(value => value.name);
    const literals =
        literalStrings(type) ??
        (type.kind === ReflectionKind.enum
            ? (type as TypeEnum).values.filter((value): value is string => typeof value === 'string')
            : undefined);
    if (!literals) {
        return [`${where}: schema delivers enum ${gql.name}, but '${describe(type)}' accepts none of its values.`];
    }
    const missing = names.filter(name => !literals.includes(name));
    return missing.length
        ? [`${where}: enum ${gql.name} can deliver '${missing.join("', '")}', which '${describe(type)}' rejects.`]
        : [];
}

function checkInputObject(
    type: Type,
    gql: GraphQLInputObjectType,
    where: string,
    options: CompatCheckOptions,
    seen: Seen,
): string[] {
    const objectMembers = members(type);
    if (!objectMembers) {
        return [`${where}: schema delivers input ${gql.name}, but '${describe(type)}' is not an object type.`];
    }
    if (alreadySeen(seen, type, `in:${gql.name}`)) return [];

    const errors: string[] = [];
    const fields = gql.getFields();

    for (const [fieldName, field] of Object.entries(fields)) {
        const fieldWhere = `${where}.${fieldName}`;
        const property = objectMembers.find(member => member.name === fieldName);
        if (!property) {
            errors.push(
                `${fieldWhere}: input field ${gql.name}.${fieldName} has no counterpart in '${describe(type)}' — ` +
                    `what a client sends there would be silently dropped.`,
            );
            continue;
        }
        errors.push(
            ...checkInputPosition(
                property.type,
                property.optional,
                field.type,
                field.default !== undefined,
                fieldWhere,
                options,
                seen,
            ),
        );
    }

    // A required TS property with no schema counterpart never arrives —
    // validation would then reject every single call.
    for (const property of objectMembers) {
        if (property.name === '__typename' || property.optional || fields[property.name]) continue;
        if (admits(property.type, ReflectionKind.undefined)) continue;
        errors.push(
            `${where}.${property.name}: required by the declared type but input ${gql.name} has no such field — ` +
                `it can never be populated.`,
        );
    }
    return errors;
}
