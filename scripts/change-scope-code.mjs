// Parser-based checks for the .ts and .tsx files a client change may touch. A content module runs at build time (and
// contact-fields.ts also runs inside the contact Worker), so "it only changes text" is not enough: the file must BE
// plain data. A new page must be built only from what the site already has. Uses the TypeScript parser, which is already
// a dev dependency; nothing is executed. This is best-effort static analysis, one layer among several (CodeQL, the
// required checks and the preview are the others); see docs/CHANGE-SCOPE.md.
import ts from "typescript";
import { rules as defaultRules } from "./change-scope-rules.mjs";

const { SyntaxKind: K } = ts;
const kindName = (node) => ts.SyntaxKind[node.kind];

/** `import type { A } from "x"` and `import { type A } from "x"`: erased at build time, so they run nothing. */
function isTypeOnlyImport(node) {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings;
  return !clause.name && !!bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly);
}

const specifierOf = (node) => (ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : "(not a string)");

// ---- content modules: plain data only ---------------------------------------------------------------------------

function contentImportAllowed(spec, rules) {
  const match = /^(?:\.\/|@\/content\/)([A-Za-z0-9_-]+)$/.exec(spec);
  return !!match && !rules.contentWiring.includes(`src/content/${match[1]}.ts`);
}

function dataProblem(node, rules) {
  switch (node.kind) {
    case K.StringLiteral:
    case K.NoSubstitutionTemplateLiteral:
    case K.NumericLiteral:
    case K.BigIntLiteral:
    case K.TrueKeyword:
    case K.FalseKeyword:
    case K.NullKeyword:
      return null;
    case K.Identifier:
      return rules.denyIdentifiers.includes(node.text) ? `uses ${node.text}` : null;
    case K.ArrayLiteralExpression:
      return firstProblem(node.elements, (n) => dataProblem(n, rules));
    case K.SpreadElement:
    case K.AsExpression:
    case K.SatisfiesExpression:
    case K.ParenthesizedExpression:
    case K.TypeAssertionExpression:
    case K.NonNullExpression:
      return dataProblem(node.expression, rules);
    case K.PrefixUnaryExpression:
      return dataProblem(node.operand, rules);
    case K.PropertyAccessExpression:
      return rules.denyProperties.includes(node.name.text) ? `uses .${node.name.text}` : dataProblem(node.expression, rules);
    case K.BinaryExpression:
      return node.operatorToken.kind === K.PlusToken ? firstProblem([node.left, node.right], (n) => dataProblem(n, rules)) : `uses an operator (${kindName(node.operatorToken)})`;
    case K.ObjectLiteralExpression:
      return firstProblem(node.properties, (prop) => {
        if (ts.isShorthandPropertyAssignment(prop)) return dataProblem(prop.name, rules);
        if (ts.isSpreadAssignment(prop)) return dataProblem(prop.expression, rules);
        if (!ts.isPropertyAssignment(prop)) return `has a method or accessor (${kindName(prop)})`;
        const key = ts.isComputedPropertyName(prop.name) ? dataProblem(prop.name.expression, rules) : null;
        return key ?? dataProblem(prop.initializer, rules);
      });
    default:
      return `uses ${kindName(node)}, which is code, not data`;
  }
}

function firstProblem(nodes, check) {
  for (const node of nodes) {
    const problem = check(node);
    if (problem) return problem;
  }
  return null;
}

function contentStatementProblem(statement, rules) {
  if (ts.isImportDeclaration(statement)) {
    if (isTypeOnlyImport(statement) || contentImportAllowed(specifierOf(statement), rules)) return null;
    return `imports ${specifierOf(statement)}, which a content file may not import`;
  }
  if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) return null;
  if (ts.isExportDeclaration(statement)) {
    return statement.isTypeOnly || !statement.moduleSpecifier ? null : `re-exports from ${specifierOf(statement)}`;
  }
  if (ts.isVariableStatement(statement)) {
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) return "declares a variable that is not const";
    return firstProblem(statement.declarationList.declarations, (d) => {
      if (!ts.isIdentifier(d.name)) return "takes a value apart (destructuring)";
      return d.initializer ? dataProblem(d.initializer, rules) : null;
    });
  }
  return `contains ${kindName(statement)}, which is code, not data`;
}

/** Why `text` is not a plain-data content module, or null when it is. */
export function contentModuleProblem(text, rules = defaultRules) {
  if (text.includes("\0")) return "contains a binary (NUL) byte";
  const source = ts.createSourceFile("module.ts", text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  return firstProblem(source.statements, (s) => contentStatementProblem(s, rules));
}

// ---- new pages --------------------------------------------------------------------------------------------------

const PAGE_STATEMENTS = [ts.isVariableStatement, ts.isFunctionDeclaration, ts.isTypeAliasDeclaration, ts.isInterfaceDeclaration, ts.isExportAssignment];

function pageImportProblem(spec, existsAtBase, rules) {
  const { exact, contentPrefix, componentPrefix } = rules.pageImports;
  if (exact.includes(spec)) return null;
  if (spec.startsWith(contentPrefix)) {
    const target = `src/content/${spec.slice(contentPrefix.length)}.ts`;
    if (rules.contentFile.test(target) && !rules.contentWiring.includes(target)) return null;
  } else if (spec.startsWith(componentPrefix)) {
    const target = `src/components/${spec.slice(componentPrefix.length)}`;
    if ([".tsx", ".ts", "/index.tsx", "/index.ts"].some((ending) => existsAtBase(target + ending))) return null;
  }
  return `a new page imports ${spec}, which is not an existing component, content file or @/lib/metadata`;
}

function pageNodeProblem(node, rules) {
  if (ts.isIdentifier(node) && rules.denyIdentifiers.includes(node.text)) return `a new page may not use ${node.text}`;
  if (ts.isPropertyAccessExpression(node) && rules.denyProperties.includes(node.name.text)) return `a new page may not use .${node.name.text}`;
  if (ts.isElementAccessExpression(node)) {
    const key = node.argumentExpression;
    if ((ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) && (rules.denyProperties.includes(key.text) || rules.denyIdentifiers.includes(key.text))) {
      return `a new page may not use ["${key.text}"]`;
    }
    if (ts.isBinaryExpression(key) || ts.isTemplateExpression(key) || ts.isCallExpression(key)) return "a new page may not build a property name at run time";
  }
  if (ts.isCallExpression(node) && node.expression.kind === K.ImportKeyword) return "a new page may not use a dynamic import()";
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const tag = node.tagName.getText();
    if (rules.denyJsxTags.includes(tag)) return `a new page may not use the <${tag}> tag`;
  }
  if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) && /^\s*(?:javascript|data):/i.test(node.initializer.text)) {
    return `a new page may not use a ${node.initializer.text.split(":")[0]}: link`;
  }
  return undefined;
}

/** Why `text` is not an acceptable new page, or null when it is. `existsAtBase` says whether a component file exists. */
export function pageProblem(text, existsAtBase, rules = defaultRules) {
  if (text.includes("\0")) return "contains a binary (NUL) byte";
  const source = ts.createSourceFile("page.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const problem = pageImportProblem(specifierOf(statement), existsAtBase, rules);
      if (problem) return problem;
    } else if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier) {
      continue;
    } else if (!PAGE_STATEMENTS.some((is) => is(statement))) {
      return `a new page contains ${kindName(statement)} at the top level, which is not allowed`;
    }
  }
  const visit = (node) => pageNodeProblem(node, rules) ?? ts.forEachChild(node, visit);
  return visit(source) ?? null;
}
