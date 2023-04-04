import { ExpressionCode, ExpressionText, splitExpression } from './ExpressionSplitter';
import { DataNode, jsVariablePolyfill } from './VariablePolyfill';
import { namedTypes } from 'ast-types';
import { parse, visit, types, print } from 'recast';

import { builders as b } from 'ast-types';

import { ExpressionKind, StatementKind } from 'ast-types/lib/gen/kinds';
import { parseWithEsprimaNext } from './Parser';

const v = b.identifier('v');

const shouldWrapInTry = (node: namedTypes.ASTNode) => {
	let shouldWrap = false;

	visit(node, {
		visitMemberExpression(path) {
			shouldWrap = true;
			return false;
		},
		visitCallExpression(path) {
			shouldWrap = true;
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

export const getExpressionCode = (expr: string, dataNodeName: string): string => {
	// console.log(tmpl.tmpl.getStr(expr));
	// const tmplAst = parse(tmpl.tmpl.getStr(expr), {
	// 	parser: { parse: parseWithEsprimaNext },
	// }) as types.namedTypes.File;
	// // @ts-ignore
	// tmplAst.program.body[0].declarations[0].id.name = 'asdf';
	// @ts-ignore
	// console.log(tmplAst.program.body);
	// console.log(print(tmplAst));

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
	// console.log(chunks);

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
	if (
		(chunks.filter((v) => v.type === 'code') as ParsedCode[]).some((v) => hasFunction(v.parsed))
	) {
		dataNode = b.identifier(dataNodeName);
		newProg.body.push(
			b.variableDeclaration('var', [b.variableDeclarator(dataNode, b.thisExpression())]),
		);
	}

	// So for compatibility we parse expressions the same way that `tmpl` does.
	// This means we always have an initial text chunk but if there's only a blank
	// text chunk and a code chunk then we want to return the actual value of the
	// expression, not turn it into a string.
	if (chunks.length > 2 || chunks[0].text !== '') {
		const parts: ExpressionKind[] = [];
		for (const chunk of chunks) {
			// This is just a text chunks, push it up as a literal.
			if (chunk.type === 'text') {
				parts.push(b.literal(chunk.text));
				// This is a code chunk so do some magic
			} else {
				const parsed = jsVariablePolyfill(chunk.parsed, dataNode)?.[0];
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
						// creating an empty statement
						b.emptyStatement(),
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
			newProg.body.push(
				b.returnStatement(
					b.callExpression(b.memberExpression(b.arrayExpression(parts), b.identifier('join')), [
						b.literal(''),
					]),
				),
			);
		}
	} else {
		const parsed = jsVariablePolyfill((chunks[1] as ParsedCode).parsed, dataNode)?.[0];
		if (!parsed || parsed.type !== 'ExpressionStatement') {
			throw new Error('AAAAAAAAAAA');
		}

		let retData: StatementKind = b.returnStatement(parsed.expression);
		if (shouldWrapInTry(parsed)) {
			retData = wrapInErrorHandler(retData);
		}
		newProg.body.push(retData);
	}

	// const problem: any[] = [];
	// console.log('same?', types.astNodesAreEquivalent(tmplAst.program, newProg, problem));
	// console.log(problem);
	// console.log(tmpl.tmpl.getStr(expr));

	// 	console.log(
	// 		// @ts-ignore
	// 		tmplAst.program.body[1].argument.callee.object.elements[1].callee.object.body.body,
	// 		// @ts-ignore
	// 		newProg.body[1].argument.callee.object.elements[1].callee.object.body.body,
	// 	);

	return print(newProg).code;
};
