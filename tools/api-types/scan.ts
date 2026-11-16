/**
 * Every place the site's source asks the content API for something (spec 012,
 * research R1), found by reading the source rather than grepping it: URLs are
 * built across lines, in template strings, and through a variable or a class
 * property set to `CONTENT_SERVICE` somewhere else in the file.
 *
 * A call is an `HttpClient` get/post/put/delete/request, or a `fetch()`, whose
 * URL depends on `CONTENT_SERVICE` or a literal `/ContentService`.
 *
 * It follows a URL through a variable, a class property, or a `this.x = …`
 * set in the file. It does not follow a URL a method of the class builds
 * (`this.url(p)`), one from a helper in another file, or a client called
 * through another name (`const c = this.http`): none of these is in the
 * source today (checked independently in the review of #542). A call written
 * that way is not seen, so write content API calls plainly.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ROOT } from './compile.ts';

/** A content API call found in the source. */
export interface ScannedCall {
  file: string;
  method: string;
  /** The HttpClient method upper-cased, or FETCH. */
  http: string;
  /** Its type argument as written, its responseType, or '(untyped)'. */
  readAs: string;
  line: number;
}

const HTTP = new Set(['get', 'post', 'put', 'delete', 'request']);
const CONTENT = /\bCONTENT_SERVICE\b|\/ContentService\b/;

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules') found.push(...sourceFiles(full));
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts'))
      found.push(full);
  }
  return found;
}

/** A node's parent: undefined for a source file, whatever its type says. */
const parentOf = (node: ts.Node): ts.Node | undefined => node.parent as ts.Node | undefined;

/** The name of the method, property or function a node sits in. */
function enclosing(node: ts.Node): string {
  for (let at = parentOf(node); at; at = parentOf(at)) {
    if (
      (ts.isMethodDeclaration(at) ||
        ts.isPropertyDeclaration(at) ||
        ts.isFunctionDeclaration(at) ||
        ts.isGetAccessor(at)) &&
      at.name
    )
      return at.name.getText();
    if (ts.isConstructorDeclaration(at)) return 'constructor';
    if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name)) return at.name.text;
  }
  return '(top level)';
}

/**
 * Whether `expression` depends on the content API's address: directly, or
 * through an identifier or `this.` property whose declaration in the same file
 * does, followed a few steps.
 */
function reachesContent(
  expression: ts.Node,
  sourceFile: ts.SourceFile,
  seen = new Set<string>()
): boolean {
  if (CONTENT.test(expression.getText())) return true;
  let reaches = false;
  const visit = (node: ts.Node): void => {
    if (reaches) return;
    let name: string | undefined;
    if (ts.isIdentifier(node)) name = node.text;
    else if (
      ts.isPropertyAccessExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ThisKeyword
    )
      name = node.name.text;
    if (name && !seen.has(name)) {
      seen.add(name);
      const declaration = findDeclaration(sourceFile, name);
      if (declaration && reachesContent(declaration, sourceFile, seen)) reaches = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return reaches;
}

/** The value given a variable, property or parameter default named `name`, or a `this.name = …`, if any. */
function findDeclaration(sourceFile: ts.SourceFile, name: string): ts.Expression | undefined {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isParameter(node)) &&
      node.name.getText() === name &&
      node.initializer
    )
      found = node.initializer;
    else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
      node.left.name.text === name
    )
      found = node.right;
    else ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** What the call reads its answer as: its type argument, or the responseType it asks for. */
function readAs(call: ts.CallExpression): string {
  const options = call.arguments
    .slice(1)
    .find(
      (a): a is ts.ObjectLiteralExpression =>
        ts.isObjectLiteralExpression(a) && /\bresponseType\b/.test(a.getText())
    );
  const property = options?.properties.find(
    (p): p is ts.PropertyAssignment =>
      ts.isPropertyAssignment(p) && p.name.getText() === 'responseType'
  );
  const responseType = property?.initializer.getText().replace(/['"]/g, '');
  if (responseType) return responseType;
  return call.typeArguments?.map((t) => t.getText()).join(', ') ?? '(untyped)';
}

/**
 * [{file, method, http, readAs, line}] for every content API call under
 * `projects/`, in file order. `http` is the HttpClient method, or 'fetch'.
 */
export function scanCalls(root = path.join(ROOT, 'projects')): ScannedCall[] {
  const calls: ScannedCall[] = [];
  for (const full of sourceFiles(root)) {
    const text = readFileSync(full, 'utf8');
    if (!/\b(http|fetch)\b/.test(text)) continue;
    const sourceFile = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.arguments.length) {
        const callee = node.expression;
        const http =
          ts.isPropertyAccessExpression(callee) && HTTP.has(callee.name.text)
            ? /\bhttp\b|HttpClient/i.test(callee.expression.getText()) && callee.name.text
            : ts.isIdentifier(callee) && callee.text === 'fetch' && 'fetch';
        if (http) {
          const url = http === 'request' ? node.arguments[1] : node.arguments[0];
          if (url && reachesContent(url, sourceFile))
            calls.push({
              file: path.relative(ROOT, full),
              method: enclosing(node),
              http: http.toUpperCase(),
              readAs: readAs(node),
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return calls;
}
