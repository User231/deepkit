/**
 * Deepkit Framework - Public Benchmark
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * Validation: Deepkit vs Zod
 *
 * This benchmark compares Deepkit's runtime type validation against Zod,
 * one of the most popular TypeScript validation libraries.
 */

import { BenchSuite } from '../../../bench';
import { guard, validate } from '@deepkit/type';
import { z } from 'zod';

// ============================================================================
// Test Models - Realistic user data structure
// ============================================================================

// Deepkit uses native TypeScript interfaces
interface User {
    id: number;
    email: string;
    name: string;
    age: number;
    active: boolean;
    roles: string[];
    profile: {
        bio: string;
        website: string;
        social: {
            twitter?: string;
            github?: string;
        };
    };
    createdAt: Date;
}

// Zod requires explicit schema definition
const zodUserSchema = z.object({
    id: z.number(),
    email: z.string(),
    name: z.string(),
    age: z.number(),
    active: z.boolean(),
    roles: z.array(z.string()),
    profile: z.object({
        bio: z.string(),
        website: z.string(),
        social: z.object({
            twitter: z.string().optional(),
            github: z.string().optional(),
        }),
    }),
    createdAt: z.date(),
});

// ============================================================================
// Test Data
// ============================================================================

const validUser = {
    id: 1,
    email: 'john@example.com',
    name: 'John Doe',
    age: 30,
    active: true,
    roles: ['admin', 'user'],
    profile: {
        bio: 'Software developer',
        website: 'https://example.com',
        social: {
            twitter: '@johndoe',
            github: 'johndoe',
        },
    },
    createdAt: new Date('2024-01-01'),
};

const invalidUser = {
    id: 'not-a-number', // Invalid
    email: 'john@example.com',
    name: 'John Doe',
    age: 30,
    active: true,
    roles: ['admin', 'user'],
    profile: {
        bio: 'Software developer',
        website: 'https://example.com',
        social: {},
    },
    createdAt: new Date('2024-01-01'),
};

// ============================================================================
// Benchmark
// ============================================================================

export default async function() {
    const suite = new BenchSuite('Validation: Deepkit vs Zod');

    // Pre-compile validators
    const deepkitGuard = guard<User>();
    const deepkitValidate = (data: unknown) => validate<User>(data);

    // Zod validators
    const zodParse = (data: unknown) => zodUserSchema.safeParse(data);

    // Sanity checks
    if (!deepkitGuard(validUser)) {
        throw new Error('Deepkit should accept valid user');
    }
    if (deepkitGuard(invalidUser)) {
        throw new Error('Deepkit should reject invalid user');
    }
    if (!zodParse(validUser).success) {
        throw new Error('Zod should accept valid user');
    }
    if (zodParse(invalidUser).success) {
        throw new Error('Zod should reject invalid user');
    }

    // ========================================================================
    // Valid data (happy path - most common in production)
    // ========================================================================

    suite.add('Deepkit (valid)', () => {
        deepkitGuard(validUser);
    });

    suite.add('Zod (valid)', () => {
        zodParse(validUser);
    });

    // ========================================================================
    // Invalid data (error path)
    // ========================================================================

    suite.add('Deepkit (invalid)', () => {
        deepkitGuard(invalidUser);
    });

    suite.add('Zod (invalid)', () => {
        zodParse(invalidUser);
    });

    return suite;
}
