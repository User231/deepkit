/**
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

import { BenchSuite } from '../../suite';
import { deserialize, serialize, Excluded } from '@deepkit/type';

/**
 * Serialization benchmark - compares Deepkit type serialization performance
 *
 * This benchmark tests two scenarios:
 * 1. Small model - Simple class with basic types
 * 2. Medium model - Complex class with nested objects, enums, dates, and excluded properties
 */

// ============================================================================
// Small Model - Basic serialization test
// ============================================================================

class SmallModel {
    ready?: boolean;
    tags: string[] = [];
    priority: number = 0;

    constructor(
        public id: number,
        public name: string
    ) {}
}

const smallPlainData = {
    name: 'name',
    id: 2,
    tags: ['a', 'b', 'c'],
    priority: 5,
    ready: true,
};

// ============================================================================
// Medium Model - Complex serialization test with nested types
// ============================================================================

class SubModel {
    age?: number;
    constructorUsed = false;

    constructor(public label: string) {
        this.constructorUsed = true;
    }
}

enum Plan {
    DEFAULT,
    PRO,
    ENTERPRISE,
}

class MediumModel {
    type: number = 0;
    yesNo: boolean = false;
    plan: Plan = Plan.DEFAULT;
    created: Date = new Date();
    types: string[] = [];
    children: SubModel[] = [];
    childrenMap: { [key: string]: SubModel } = {};
    notMapped: { [key: string]: any } = {};
    excluded: string & Excluded = 'default';
    excludedForPlain: string & Excluded<'json'> = 'excludedForPlain';

    constructor(public name: string) {}
}

const mediumPlainData = {
    name: 'name',
    type: 2,
    plan: Plan.ENTERPRISE,
    children: [{ label: 'label' }],
    childrenMap: { 'sub': { label: 'label' } },
    types: ['a', 'b', 'c']
};

export default async function() {
    const suite = new BenchSuite('type/serialization');

    // ========================================================================
    // Small Model Benchmarks
    // ========================================================================

    // Deserialize: plain object -> class instance
    const smallInstance = deserialize<SmallModel>(smallPlainData);

    // Sanity checks
    if (!(smallInstance instanceof SmallModel)) {
        throw new Error('Small model deserialization should return SmallModel instance');
    }
    const smallSerialized = serialize<SmallModel>(smallInstance);
    if (smallSerialized instanceof SmallModel) {
        throw new Error('Serialization should return plain object, not class instance');
    }

    suite.add('deepkit small deserialize', () => {
        deserialize<SmallModel>(smallPlainData);
    }, { category: 'p0' });

    suite.add('deepkit small serialize', () => {
        serialize<SmallModel>(smallInstance);
    }, { category: 'p0' });

    // ========================================================================
    // Medium Model Benchmarks
    // ========================================================================

    // Deserialize: plain object -> class instance
    const mediumInstance = deserialize<MediumModel>(mediumPlainData);

    // Sanity checks
    if (!(mediumInstance instanceof MediumModel)) {
        throw new Error('Medium model deserialization should return MediumModel instance');
    }
    if (mediumInstance.children.length === 0 || !(mediumInstance.children[0] instanceof SubModel)) {
        throw new Error('Nested SubModel should be deserialized correctly');
    }

    suite.add('deepkit medium deserialize', () => {
        deserialize<MediumModel>(mediumPlainData);
    }, { category: 'p0' });

    suite.add('deepkit medium serialize', () => {
        serialize<MediumModel>(mediumInstance);
    }, { category: 'p0' });

    suite.run();
}
