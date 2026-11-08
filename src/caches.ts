// Cache names shared by the page and the service worker (both derive them from the app's path).
// The audio cache is filled by the page as it loads each sound and only pruned by the worker, so
// every sound is downloaded once, and an update downloads only sounds whose content changed
// (their file names are content hashes).

export const cachePrefix = (scopePath: string) => `meditation:${scopePath}:`;
export const audioCacheName = (scopePath: string) => `${cachePrefix(scopePath)}audio`;
