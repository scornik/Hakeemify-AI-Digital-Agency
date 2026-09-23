/**
 * Manifest drift check — MagicUI's `--check` pattern, with ts-morph.
 *
 * A manifest that understates its imports is how an island, a runtime, or a licence reaches a
 * client's site unannounced: the pipeline budgets JS from the manifest, the allowlist gates on
 * the manifest, and the licence gate walks the manifest's dependency closure. None of them
 * notice an import the manifest never mentioned.
 *
 * `.astro` is not TypeScript, so the frontmatter fence is extracted first and parsed on its
 * own. The fence is real TypeScript — that is the whole reason the language is usable here —
 * and everything after it is template markup ts-morph must never see.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { Project, ScriptTarget, SyntaxKind } from 'ts-morph';
import type { SectionManifest } from './schema.js';

export interface Frontmatter {
  readonly code: string;
  /** 1-based line of the first line of code, so a reported position maps back to the file. */
  readonly startLine: number;
}

const FENCE = /^---[ \t]*\r?\n/;

/**
 * Extract an `.astro` frontmatter fence. Returns `null` when the file has no fence, which is
 * legal Astro (a markup-only component) and not a problem.
 */
export function extractAstroFrontmatter(source: string): Frontmatter | null {
  // A fence only counts at the very top of the file, modulo a byte-order mark.
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const open = FENCE.exec(text);
  if (open === null) return null;
  const bodyStart = open[0].length;
  const closeIndex = text.indexOf('\n---', bodyStart - 1);
  if (closeIndex === -1) return null;
  return {
    code: text.slice(bodyStart, closeIndex + 1),
    startLine: 2,
  };
}

/** Module specifiers we never expect a manifest to declare. */
function isIgnorable(specifier: string): boolean {
  return (
    specifier.startsWith('node:') ||
    // Astro's virtual modules (`astro:assets`, `astro:content`, …) are supplied by the
    // renderer, not by a package, so there is nothing for a manifest to declare.
    specifier.startsWith('astro:') ||
    isBuiltin(specifier)
  );
}

export function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/** `zod/v4` → `zod`; `@ada/contract/x` → `@ada/contract`. */
export function packageNameOf(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split('/')[0] ?? specifier;
}

const project = new Project({
  useInMemoryFileSystem: true,
  compilerOptions: { target: ScriptTarget.ESNext, allowJs: true },
  skipAddingFilesFromTsConfig: true,
});

let counter = 0;

/**
 * Every module specifier a TypeScript source imports: static imports, `export … from`, and
 * dynamic `import()`. Type-only imports count — they are a real coupling to a real package,
 * and a manifest that omits one is still describing a file that does not exist without it.
 */
export function scanImportSpecifiers(code: string): string[] {
  const file = project.createSourceFile(`scan-${(counter += 1)}.ts`, code, { overwrite: true });
  try {
    const found = new Set<string>();
    for (const declaration of file.getImportDeclarations()) {
      found.add(declaration.getModuleSpecifierValue());
    }
    for (const declaration of file.getExportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if (specifier !== undefined) found.add(specifier);
    }
    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
      const [argument] = call.getArguments();
      if (argument?.getKind() === SyntaxKind.StringLiteral) {
        found.add(argument.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue());
      }
    }
    return [...found];
  } finally {
    project.removeSourceFile(file);
  }
}

export type ImportProblemKind =
  'missing_dependency' | 'undeclared_file' | 'missing_file' | 'unused_dependency' | 'unparseable';

export interface ImportProblem {
  readonly manifest: string;
  /** The file the problem was found in, relative to the manifest's directory. */
  readonly file: string;
  readonly kind: ImportProblemKind;
  readonly specifier?: string;
  readonly message: string;
}

/** Extensions a specifier may be written without. `.astro` first: it is the common case. */
const RESOLUTION_SUFFIXES = ['', '.astro', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.js'];

/** `./lib/format.js` in TypeScript ESM means `./lib/format.ts` on disk. */
function candidatePaths(specifier: string): string[] {
  const out = new Set<string>();
  for (const suffix of RESOLUTION_SUFFIXES) out.add(specifier + suffix);
  const ext = extname(specifier);
  if (ext === '.js') {
    out.add(specifier.replace(/\.js$/, '.ts'));
    out.add(specifier.replace(/\.js$/, '.tsx'));
    out.add(specifier.replace(/\.js$/, '.astro'));
  }
  if (ext === '.mjs') out.add(specifier.replace(/\.mjs$/, '.mts'));
  return [...out];
}

const posix = (path: string): string => path.split('\\').join('/');

export interface CheckImportsOptions {
  /** The directory the manifest lives in; `files[].path` is relative to it. */
  readonly dir: string;
  /**
   * Declaring a dependency nothing imports is drift too, but it is the harmless direction, so
   * it is reported and off by default.
   */
  readonly reportUnused?: boolean;
}

/**
 * Check one manifest against the files it declares.
 *
 * Returns every problem found; an empty array means the manifest tells the truth. Nothing here
 * throws on a bad file — a syntactically broken `.astro` is reported as `unparseable` so one
 * broken section cannot hide the state of the rest.
 */
export function checkManifestImports(
  manifest: SectionManifest,
  { dir, reportUnused = false }: CheckImportsOptions,
): ImportProblem[] {
  const problems: ImportProblem[] = [];
  const declaredPackages = new Set([
    ...manifest.dependencies.map(packageNameOf),
    ...manifest.devDependencies.map(packageNameOf),
  ]);
  const declaredFiles = new Set(manifest.files.map((file) => posix(file.path)));
  const usedPackages = new Set<string>();

  for (const file of manifest.files) {
    const absolute = join(dir, file.path);
    if (!existsSync(absolute)) {
      problems.push({
        manifest: manifest.name,
        file: posix(file.path),
        kind: 'missing_file',
        message: `${file.path} is declared but not on disk`,
      });
      continue;
    }

    const source = readFileSync(absolute, 'utf8');
    let code: string;
    if (extname(file.path) === '.astro') {
      const frontmatter = extractAstroFrontmatter(source);
      if (frontmatter === null) continue; // markup-only component: nothing to import
      code = frontmatter.code;
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(file.path)) {
      code = source;
    } else {
      continue; // css, svg, json: not a module graph this check understands
    }

    let specifiers: string[];
    try {
      specifiers = scanImportSpecifiers(code);
    } catch (error) {
      /* c8 ignore next 8 -- ts-morph recovers from syntax errors; this is a guard, not a path */
      problems.push({
        manifest: manifest.name,
        file: posix(file.path),
        kind: 'unparseable',
        message: error instanceof Error ? error.message : 'could not be parsed',
      });
      continue;
    }

    for (const specifier of specifiers) {
      if (isIgnorable(specifier)) continue;

      if (isRelative(specifier)) {
        const from = dirname(absolute);
        const resolved = candidatePaths(resolve(from, specifier)).find((candidate) =>
          existsSync(candidate),
        );
        const relativeToDir = resolved === undefined ? null : posix(relative(dir, resolved));
        if (relativeToDir === null || !declaredFiles.has(relativeToDir)) {
          problems.push({
            manifest: manifest.name,
            file: posix(file.path),
            kind: 'undeclared_file',
            specifier,
            message:
              relativeToDir === null
                ? `imports ${specifier}, which does not resolve to a file on disk`
                : `imports ${specifier} (${relativeToDir}), which the manifest's files[] does not declare`,
          });
        }
        continue;
      }

      const pkg = packageNameOf(specifier);
      usedPackages.add(pkg);
      if (!declaredPackages.has(pkg)) {
        problems.push({
          manifest: manifest.name,
          file: posix(file.path),
          kind: 'missing_dependency',
          specifier,
          message: `imports ${specifier}, but the manifest does not declare the dependency "${pkg}"`,
        });
      }
    }
  }

  if (reportUnused) {
    for (const declared of declaredPackages) {
      if (usedPackages.has(declared)) continue;
      problems.push({
        manifest: manifest.name,
        file: 'manifest.yml',
        kind: 'unused_dependency',
        specifier: declared,
        message: `declares the dependency "${declared}", which no declared file imports`,
      });
    }
  }

  return problems;
}
