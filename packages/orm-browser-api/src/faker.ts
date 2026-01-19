import { ReflectionKind, Type } from '@deepkit/type';

export type FakerDataType = 'string' | 'date' | 'number' | 'boolean' | 'any';

export type FakerTypes = Record<
    string,
    {
        example: any;
        type: FakerDataType;
    }
>;

export function getType(v: any): FakerDataType {
    if ('string' === typeof v) return 'string';
    if ('number' === typeof v) return 'number';
    if ('boolean' === typeof v) return 'boolean';
    if (v instanceof Date) return 'date';
    return 'any';
}

export function findFakerForName(types: FakerTypes, name: string, type: FakerDataType): string | undefined {
    for (const [fakeName, info] of Object.entries(types)) {
        if (info.type !== type) continue;
        const [p1, p2] = fakeName.toLowerCase().split('.');
        if (p2 && p2.includes(name)) return fakeName;
        if (p2 && name.includes(p2)) return fakeName;
    }
    return undefined;
}

export function findFaker(types: FakerTypes, propertyName: string, type: Type): string {
    const name = propertyName.toLowerCase();

    if (type.kind === ReflectionKind.class && type.classType === Date) {
        if (name.includes('birthdate')) return 'date.past';
        if (name.endsWith('ed')) return 'date.past';

        return 'date.future';
    } else if (type.kind === ReflectionKind.number || type.kind === ReflectionKind.bigint) {
        return findFakerForName(types, name, 'number') || 'number.int';
    } else if (type.kind === ReflectionKind.boolean) {
        return 'datatype.boolean';
    } else if (type.kind === ReflectionKind.string) {
        if (name.includes('first')) return 'person.firstName';
        if (name.includes('last')) return 'person.lastName';
        if (name.includes('iban')) return 'finance.iban';
        if (name.includes('bic')) return 'finance.bic';
        if (name.includes('name')) return 'internet.username';
        if (name.includes('image')) return 'image.url';
        if (name.includes('mobile')) return 'phone.number';
        if (name.includes('phone')) return 'phone.number';

        return findFakerForName(types, name, 'string') || 'string.alphanumeric';
    }

    return '';
}

// @faker-js/faker v8 API
// Migration: https://v8.fakerjs.dev/guide/upgrading.html
export const fakerFunctions: string[] = [
    // location (was address)
    'location.zipCode',
    'location.city',
    'location.streetAddress',
    'location.secondaryAddress',
    'location.county',
    'location.country',
    'location.countryCode',
    'location.state',
    'location.latitude',
    'location.longitude',
    'location.direction',
    'location.cardinalDirection',
    'location.ordinalDirection',
    'location.timeZone',
    // color (was commerce.color)
    'color.human',
    // commerce
    'commerce.department',
    'commerce.productName',
    'commerce.price',
    'commerce.productAdjective',
    'commerce.productMaterial',
    'commerce.product',
    'commerce.productDescription',
    // company
    'company.name',
    'company.catchPhrase',
    'company.buzzPhrase',
    'company.buzzAdjective',
    'company.buzzNoun',
    'company.buzzVerb',
    // database
    'database.column',
    'database.type',
    'database.collation',
    'database.engine',
    // date
    'date.past',
    'date.future',
    'date.recent',
    'date.soon',
    'date.month',
    'date.weekday',
    // finance
    'finance.accountNumber',
    'finance.accountName',
    'finance.routingNumber',
    'finance.maskedNumber',
    'finance.amount',
    'finance.transactionType',
    'finance.currencyCode',
    'finance.currencyName',
    'finance.currencySymbol',
    'finance.bitcoinAddress',
    'finance.litecoinAddress',
    'finance.creditCardNumber',
    'finance.creditCardCVV',
    'finance.ethereumAddress',
    'finance.iban',
    'finance.bic',
    'finance.transactionDescription',
    // git
    'git.branch',
    'git.commitEntry',
    'git.commitMessage',
    'git.commitSha',
    // hacker
    'hacker.abbreviation',
    'hacker.adjective',
    'hacker.noun',
    'hacker.verb',
    'hacker.ingverb',
    'hacker.phrase',
    // image
    'image.url',
    'image.urlLoremFlickr',
    'image.urlPicsumPhotos',
    'image.dataUri',
    'image.avatar',
    // internet
    'internet.email',
    'internet.exampleEmail',
    'internet.username',
    'internet.displayName',
    'internet.protocol',
    'internet.httpMethod',
    'internet.url',
    'internet.domainName',
    'internet.domainSuffix',
    'internet.domainWord',
    'internet.ip',
    'internet.ipv4',
    'internet.ipv6',
    'internet.port',
    'internet.userAgent',
    'internet.color',
    'internet.mac',
    'internet.password',
    // lorem
    'lorem.word',
    'lorem.words',
    'lorem.sentence',
    'lorem.slug',
    'lorem.sentences',
    'lorem.paragraph',
    'lorem.paragraphs',
    'lorem.text',
    'lorem.lines',
    // music
    'music.genre',
    'music.songName',
    // person (was name)
    'person.firstName',
    'person.lastName',
    'person.middleName',
    'person.fullName',
    'person.jobTitle',
    'person.sex',
    'person.prefix',
    'person.suffix',
    'person.jobDescriptor',
    'person.jobArea',
    'person.jobType',
    // phone
    'phone.number',
    'phone.imei',
    // number (was random.number/float)
    'number.int',
    'number.float',
    // string (was random)
    'string.uuid',
    'string.alpha',
    'string.alphanumeric',
    'string.hexadecimal',
    'string.numeric',
    'string.sample',
    // datatype
    'datatype.boolean',
    // helpers (was random)
    'helpers.arrayElement',
    'helpers.arrayElements',
    // system
    'system.fileName',
    'system.commonFileName',
    'system.mimeType',
    'system.commonFileType',
    'system.commonFileExt',
    'system.fileType',
    'system.fileExt',
    'system.directoryPath',
    'system.filePath',
    'system.semver',
    // vehicle
    'vehicle.vehicle',
    'vehicle.manufacturer',
    'vehicle.model',
    'vehicle.type',
    'vehicle.fuel',
    'vehicle.vin',
    'vehicle.color',
    'vehicle.vrm',
    // word
    'word.adjective',
    'word.adverb',
    'word.conjunction',
    'word.interjection',
    'word.noun',
    'word.preposition',
    'word.verb',
    'word.sample',
    'word.words',
];
