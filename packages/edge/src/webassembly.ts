/**
 * WebAssembly in an app's build (ADR 0014). Only an app that declares it may compile
 * WebAssembly, so the build of such an app must have modules and the build of any other app
 * must have none: a new dependency cannot widen the Content-Security-Policy unnoticed. And
 * only workers load modules, so that a long computation never blocks the page.
 */

/** Whether a served path is a WebAssembly module. */
export function isWebAssemblyPath(path: string): boolean {
  return path.endsWith(".wasm");
}

/** A script of the page, which is not a worker's. */
export interface PageScript {
  readonly fileName: string;
  readonly code: string;
}

export interface WebAssemblyBuild {
  /** Whether the app declares WebAssembly: `webAssembly` of `edge()`. */
  readonly declared: boolean;
  /** Every served path of the build, such as `/assets/add-0123abcd.wasm`. */
  readonly paths: readonly string[];
  /** The page's own scripts, without its workers. */
  readonly pageScripts: readonly PageScript[];
}

/**
 * Throws unless the build's WebAssembly is as ADR 0014 allows. Returns whether the
 * Content-Security-Policy must allow it.
 */
export function assertWebAssembly({ declared, paths, pageScripts }: WebAssemblyBuild): boolean {
  const modules = paths.filter(isWebAssemblyPath);
  if (!declared) {
    if (modules.length > 0) {
      throw new Error(
        `The build has WebAssembly (${modules.join(", ")}), which only an app that declares webAssembly may compile (ADR 0014).`,
      );
    }
    return false;
  }
  if (modules.length === 0) {
    throw new Error(
      "The app declares webAssembly, but its build has no WebAssembly module: remove the declaration (ADR 0014).",
    );
  }
  for (const script of pageScripts) {
    for (const module of modules) {
      if (script.code.includes(module.slice(module.lastIndexOf("/") + 1))) {
        throw new Error(
          `${script.fileName} refers to ${module}, but only workers load WebAssembly (ADR 0014).`,
        );
      }
    }
  }
  return true;
}
