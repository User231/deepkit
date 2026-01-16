/**
 * Deepkit Framework - Public Benchmark
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * Serialization: Deepkit vs class-transformer
 *
 * This benchmark compares Deepkit's runtime type serialization against class-transformer,
 * a popular TypeScript serialization library.
 */

import 'reflect-metadata';
import { BenchSuite } from '../../../bench';
import { deserialize, serialize } from '@deepkit/type';
import { plainToInstance, instanceToPlain, Type, Expose } from 'class-transformer';

// ============================================================================
// Test Models - Realistic data structure
// ============================================================================

// class-transformer requires decorators
class Address {
    @Expose()
    street: string = '';

    @Expose()
    city: string = '';

    @Expose()
    zipCode: string = '';
}

class Profile {
    @Expose()
    bio: string = '';

    @Expose()
    website: string = '';

    @Expose()
    @Type(() => Date)
    joinedAt: Date = new Date();
}

class User {
    @Expose()
    id: number = 0;

    @Expose()
    email: string = '';

    @Expose()
    name: string = '';

    @Expose()
    active: boolean = false;

    @Expose()
    tags: string[] = [];

    @Expose()
    @Type(() => Address)
    address: Address = new Address();

    @Expose()
    @Type(() => Profile)
    profile: Profile = new Profile();
}

// Deepkit uses native TypeScript interfaces - same structure, no decorators needed
interface DeepkitAddress {
    street: string;
    city: string;
    zipCode: string;
}

interface DeepkitProfile {
    bio: string;
    website: string;
    joinedAt: Date;
}

interface DeepkitUser {
    id: number;
    email: string;
    name: string;
    active: boolean;
    tags: string[];
    address: DeepkitAddress;
    profile: DeepkitProfile;
}

// ============================================================================
// Test Data
// ============================================================================

const plainUser = {
    id: 1,
    email: 'john@example.com',
    name: 'John Doe',
    active: true,
    tags: ['developer', 'typescript', 'nodejs'],
    address: {
        street: '123 Main St',
        city: 'San Francisco',
        zipCode: '94105',
    },
    profile: {
        bio: 'Full-stack developer passionate about TypeScript',
        website: 'https://example.com',
        joinedAt: '2024-01-01T00:00:00.000Z',
    },
};

// ============================================================================
// Benchmark
// ============================================================================

export default async function() {
    const suite = new BenchSuite('Serialization: Deepkit vs class-transformer');

    // Pre-create instances for serialize benchmarks
    const deepkitUser = deserialize<DeepkitUser>(plainUser);
    const ctUser = plainToInstance(User, plainUser);

    // Sanity checks - deserialize
    if (typeof deepkitUser.profile.joinedAt === 'string') {
        throw new Error('Deepkit should deserialize Date');
    }
    if (!(ctUser.profile.joinedAt instanceof Date)) {
        throw new Error('class-transformer should deserialize Date');
    }

    // Sanity checks - serialize
    const deepkitSerialized = serialize<DeepkitUser>(deepkitUser);
    const ctSerialized = instanceToPlain(ctUser);

    if (deepkitSerialized.profile.joinedAt instanceof Date) {
        throw new Error('Deepkit serialize should return plain object');
    }
    // class-transformer keeps Date as Date by default (no automatic conversion)
    // This is a key difference - Deepkit converts Date to ISO string automatically

    // ========================================================================
    // Deserialize (plain object -> class/typed instance)
    // ========================================================================

    suite.add('Deepkit deserialize', () => {
        deserialize<DeepkitUser>(plainUser);
    });

    suite.add('class-transformer deserialize', () => {
        plainToInstance(User, plainUser);
    });

    // ========================================================================
    // Serialize (typed instance -> plain object)
    // ========================================================================

    suite.add('Deepkit serialize', () => {
        serialize<DeepkitUser>(deepkitUser);
    });

    suite.add('class-transformer serialize', () => {
        instanceToPlain(ctUser);
    });

    return suite;
}
