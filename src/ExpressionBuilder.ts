import { ExpressionCode, ExpressionText, splitExpression } from './ExpressionSplitter';
import { DataNode, jsVariablePolyfill } from './VariablePolyfill';
import { namedTypes } from 'ast-types';
import { parse, visit, types, print } from 'recast';

import { builders as b } from 'ast-types';

import { ExpressionKind, StatementKind } from 'ast-types/lib/gen/kinds';
import { parseWithEsprimaNext } from './Parser';
import { EXEMPT_IDENTIFIER_LIST, ParentKind } from './Constants';

export interface ExpressionAnalysis {
	has: {
		function: boolean;
		templateString: boolean;
	};
}

const v = b.identifier('v');

const isRootExempt = (
	node: types.namedTypes.MemberExpression | types.namedTypes.CallExpression,
): boolean => {
	let obj = node.type === 'MemberExpression' ? node.object : node.callee;
	while (
		obj.type === 'MemberExpression' ||
		obj.type === 'OptionalMemberExpression' ||
		obj.type === 'CallExpression' ||
		obj.type === 'OptionalCallExpression'
	) {
		if (obj.type === 'CallExpression' || obj.type === 'OptionalCallExpression') {
			obj = obj.callee;
		} else {
			obj = obj.object;
		}
	}
	if (obj.type !== 'Identifier') {
		return false;
	}
	return EXEMPT_IDENTIFIER_LIST.includes(obj.name);
};

const shouldWrapInTry = (node: namedTypes.ASTNode) => {
	let shouldWrap = false;

	visit(node, {
		visitMemberExpression(path) {
			// This is for a weird edge case in riot-tmpl
			// where if there's an optional member expression
			// or function call it doesn't wrap in an error.
			// This is purely for syntax compat and should be
			// removed when that's no longer a goal.
			if (path.node.optional) {
				shouldWrap = false;
				return false;
			}
			shouldWrap = !isRootExempt(path.node);
			const parent: ParentKind = path.parent.node;
			if (shouldWrap && parent.type !== 'MemberExpression') {
				shouldWrap = false;
			}
			if (!shouldWrap) {
				this.traverse(path);
				return;
			}

			return false;
		},
		visitCallExpression(path) {
			// This is for a weird edge case in riot-tmpl
			// where if there's an optional member expression
			// or function call it doesn't wrap in an error.
			// This is purely for syntax compat and should be
			// removed when that's no longer a goal.
			if (path.node.optional) {
				shouldWrap = false;
				return false;
			}
			shouldWrap = !isRootExempt(path.node);
			if (!shouldWrap) {
				this.traverse(path);
				return;
			}
			return false;
		},
	});

	return shouldWrap;
};

const hasFunction = (node: types.namedTypes.ASTNode) => {
	let hasFn = false;

	visit(node, {
		visitFunctionExpression(path) {
			hasFn = true;
			return false;
		},
		visitFunctionDeclaration(path) {
			hasFn = true;
			return false;
		},
		visitArrowFunctionExpression(path) {
			hasFn = true;
			return false;
		},
	});

	return hasFn;
};

const hasTemplateString = (node: types.namedTypes.ASTNode) => {
	let hasTemp = false;

	visit(node, {
		visitTemplateLiteral(path) {
			hasTemp = true;
			return false;
		},
	});

	return hasTemp;
};

const wrapInErrorHandler = (node: StatementKind) => {
	return b.tryStatement(
		b.blockStatement([node]),
		b.catchClause(
			b.identifier('e'),
			null,
			b.blockStatement([
				b.expressionStatement(
					b.callExpression(b.identifier('E'), [b.identifier('e'), b.thisExpression()]),
				),
			]),
		),
	);
};

const maybeWrapExpr = (expr: string): string => {
	if (expr.trimStart()[0] === '{') {
		return '(' + expr + ')';
	}
	return expr;
};

const buildFunctionBody = (expr: ExpressionKind) => {
	return b.blockStatement([
		// v = (<actual expression>)
		b.expressionStatement(b.assignmentExpression('=', v, expr)),
		// Return value or empty string on some falsy values
		// return v || v === 0 || v === false ? v : 0
		// The ordering is important for AST nodes to match
		// tmpl's output
		b.returnStatement(
			b.conditionalExpression(
				b.logicalExpression(
					'||',
					b.logicalExpression('||', v, b.binaryExpression('===', v, b.literal(0))),
					b.binaryExpression('===', v, b.literal(false)),
				),
				v,
				b.literal(''),
			),
		),
	]);
};

type ParsedCode = ExpressionCode & { parsed: types.namedTypes.File };

// This replaces any actual new lines with \n's. This only really
// happens to template strings.
const fixStringNewLines = (node: types.namedTypes.File): types.namedTypes.File => {
	const replace = (str: string): string => {
		return str.replace(/\n/g, '\\n');
	};
	visit(node, {
		visitTemplateElement(path) {
			this.traverse(path);
			const el = b.templateElement(
				{
					cooked: path.node.value.cooked === null ? null : replace(path.node.value.cooked),
					raw: replace(path.node.value.raw),
				},
				path.node.tail,
			);
			path.replace(el);
		},
		visitLiteral(path) {
			this.traverse(path);
			if (typeof path.node.value === 'string') {
				path.replace(b.literal(replace(path.node.value)));
			}
		},
		visitStringLiteral(path) {
			path.replace(b.stringLiteral(replace(path.node.value)));
		},
	});

	return node;
};

export const getExpressionCode = (
	expr: string,
	dataNodeName: string,
): [string, ExpressionAnalysis] => {
	const chunks = splitExpression(expr).map<ExpressionText | ParsedCode>((chunk) => {
		if (chunk.type === 'code') {
			const code = maybeWrapExpr(chunk.text);
			const node = parse(code, {
				parser: { parse: parseWithEsprimaNext },
			}) as types.namedTypes.File;

			return { ...chunk, parsed: node };
		}
		return chunk;
	});

	const newProg = b.program([
		b.variableDeclaration('var', [
			b.variableDeclarator(b.identifier('global'), b.objectExpression([])),
		]),
	]);

	// This is what's used to access that's passed in. For compatibility we us
	// `this` unless the expression contains a function. If it contains an
	// expression we instead assign a different variable to hold onto the contents
	// of `this` (default: `___n8n_data`) since functions aren't compatibility
	// anyway.
	let dataNode: DataNode = b.thisExpression();
	const hasFn = (chunks.filter((v) => v.type === 'code') as ParsedCode[]).some((v) =>
		hasFunction(v.parsed),
	);
	if (hasFn) {
		dataNode = b.identifier(dataNodeName);
		newProg.body.push(
			b.variableDeclaration('var', [b.variableDeclarator(dataNode, b.thisExpression())]),
		);
	}

	const hasTempString = (chunks.filter((v) => v.type === 'code') as ParsedCode[]).some((v) =>
		hasTemplateString(v.parsed),
	);

	// So for compatibility we parse expressions the same way that `tmpl` does.
	// This means we always have an initial text chunk but if there's only a blank
	// text chunk and a code chunk then we want to return the actual value of the
	// expression, not turn it into a string.
	if (chunks.length > 2 || chunks[0].text !== '') {
		let parts: ExpressionKind[] = [];
		for (const chunk of chunks) {
			// This is just a text chunks, push it up as a literal.
			if (chunk.type === 'text') {
				parts.push(b.literal(chunk.text));
				// This is a code chunk so do some magic
			} else {
				let parsed = jsVariablePolyfill(fixStringNewLines(chunk.parsed), dataNode)?.[0];
				if (!parsed || parsed.type !== 'ExpressionStatement') {
					throw new Error('BBBBBBBBB');
				}

				let functionBody = buildFunctionBody(parsed.expression);

				if (shouldWrapInTry(parsed)) {
					// Wraps the body of our expression function in a try/catch
					// to match tmpl
					functionBody.body = [
						wrapInErrorHandler(functionBody.body[0]),
						// This is for tmpl compat. It puts a ; after the try/catch
						// creating an empty statement. emptyStatement is just printed
						// to nothing so we use an expression statement with a blank
						// identifier.
						b.expressionStatement(b.identifier('')),
						functionBody.body[1],
					];
				}

				// Turn our expression into a function call with bound this. The function
				// it create has a parameter called `v` that we don't actually set. I think
				// this is a hack around only being able to use `var` and not `let`/`const`.
				parts.push(
					b.callExpression(
						b.memberExpression(b.functionExpression(null, [v], functionBody), b.identifier('call')),
						[b.thisExpression()],
					),
				);
			}
		}

		// Just return the raw string if it's just a single string
		if (chunks.length < 2) {
			newProg.body.push(b.returnStatement(parts[0]));
		} else {
			// Filter out empty string literals for compat
			parts = parts.filter((i) => !(i.type === 'Literal' && i.value === ''));
			newProg.body.push(
				b.returnStatement(
					b.callExpression(b.memberExpression(b.arrayExpression(parts), b.identifier('join')), [
						b.literal(''),
					]),
				),
			);
		}
	} else {
		const parsed = jsVariablePolyfill(
			fixStringNewLines((chunks[1] as ParsedCode).parsed),
			dataNode,
		)?.[0];
		if (!parsed || parsed.type !== 'ExpressionStatement') {
			throw new Error('AAAAAAAAAAA');
		}

		let retData: StatementKind = b.returnStatement(parsed.expression);
		if (shouldWrapInTry(parsed)) {
			retData = wrapInErrorHandler(retData);
		}
		newProg.body.push(retData);
	}

	return [print(newProg).code, { has: { function: hasFn, templateString: hasTempString } }];
};
