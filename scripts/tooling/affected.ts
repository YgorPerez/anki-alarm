/** Shared files invalidate every package. */
export function ciScope(base: string | undefined, changed: readonly string[]) {
  return {
    all: !base || changed.some((file) => !/^(apps|packages)\//.test(file)),
  };
}
