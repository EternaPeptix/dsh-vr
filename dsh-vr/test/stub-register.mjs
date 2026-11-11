/**
 * Installs the stub resolver before the test file's imports are resolved.
 *
 * Run with: node --import ./test/stub-register.mjs test/plugin-load.test.mjs
 */
import { register } from 'node:module';

register('./stub-loader.mjs', import.meta.url);
