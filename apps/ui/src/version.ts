declare const __APP_VERSION__: string | undefined;

/** The version of the build the screen is running, from the project's package.json at build time ("dev" when run without a build). */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
