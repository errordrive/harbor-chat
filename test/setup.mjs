// Registered via --import so the CSS resolve hook is active before tests load.
import { register } from 'node:module';
register('./css-hook.mjs', import.meta.url);
