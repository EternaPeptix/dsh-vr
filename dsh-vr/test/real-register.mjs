// Registers the opt-in resolver in real-loader.mjs. See that file.
import { register } from 'node:module';

register('./real-loader.mjs', import.meta.url);
