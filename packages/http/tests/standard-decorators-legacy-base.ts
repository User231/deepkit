import { http } from '../src/decorator.js';

/**
 * Compiled with the package's LEGACY decorator config (this file lives outside
 * tests/standard-decorators/) — the standard-emit subclass in
 * standard-decorators/standard-emit.spec.ts extends it to prove cross-ABI inheritance.
 */
export class LegacyBaseController {
    @http.GET('legacy-base')
    baseAction(): string {
        return 'base';
    }
}
