/** Shared files invalidate every package; Maestro follows the native paths directly. */
export function ciScope(base: string | undefined, changed: readonly string[]) {
  return {
    all: !base || changed.some((file) => !/^(apps|packages)\//.test(file)),
    mobile: !base || changed.some((file) => /^(apps\/mobile\/|modules\/)/.test(file)),
  };
}
