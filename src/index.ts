import { splitExpression } from './ExpressionParser';
import { DataNode, jsVariablePolyfill } from './ExpressionTransformer';
import { namedTypes } from 'ast-types';
import { getOption } from 'recast/lib/util';
import { parse, visit, types, print } from 'recast';
import { parse as esprimaParse } from 'esprima-next';

import { builders as b } from 'ast-types';

// @ts-ignore
import * as tmpl from '@n8n_io/riot-tmpl';
import { ExpressionKind, StatementKind } from 'ast-types/gen/kinds.js';

tmpl.brackets.set('{{ }}');

// Make sure that error get forwarded
tmpl.tmpl.errorHandler = (error: Error) => {
	console.error(error);
};

// console.log(jsVariablePolyfill('$json')?.code);
// console.log(jsVariablePolyfill('$json.thing / $json.otherThing')?.code);
// console.log(jsVariablePolyfill('aaa / bbb')?.code);
// console.log(jsVariablePolyfill('(asdf, asdf2) => ([asdf, asdf2])')?.code);
// console.log(jsVariablePolyfill('(asdf, asdf2 = zxcv) => ([asdf, asdf2, zxcv])')?.code);
// console.log(jsVariablePolyfill('([asdf, asdf2]) => ([asdf, asdf2])')?.code);
// console.log(jsVariablePolyfill('({asdf, asdf2}) => ([asdf, asdf2])')?.code);
// console.log(jsVariablePolyfill('({asdf, asdf2}) => ({asdf, asdf2, zxcv})')?.code);
// console.log(jsVariablePolyfill('const {test, test2} = asdf;')?.code);
// console.log(jsVariablePolyfill('const [test, test2] = asdf;')?.code);
// console.log(jsVariablePolyfill('function test(asdf, asdf2) {return [asdf, asdf2];}')?.code);
// console.log(jsVariablePolyfill('(function (asdf, asdf2) {return [asdf, asdf2];})')?.code);
//console.log(jsVariablePolyfill('({test1, test2})')?.code);
//console.log(jsVariablePolyfill('var test = test2')?.code);

function parseWithEsprimaNext(source: string, options?: any): any {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
	const ast = esprimaParse(source, {
		loc: true,
		locations: true,
		comment: true,
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		range: getOption(options, 'range', false),
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		tolerant: getOption(options, 'tolerant', true),
		tokens: true,
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		jsx: getOption(options, 'jsx', false),
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		// sourceType: getOption(options, 'sourceType', 'script'),
		sourceType: 'script',
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any);

	return ast;
}

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

const hasFunction = (code: string) => {
	const node = parse(code, {
		parser: { parse: parseWithEsprimaNext },
	}) as types.namedTypes.File;
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

export const getExpressionCode = (expr: string): string => {
	// console.log(tmpl.tmpl.getStr(expr));
	// const tmplAst = parse(tmpl.tmpl.getStr(expr), {
	// 	parser: { parse: parseWithEsprimaNext },
	// }) as types.namedTypes.File;
	// // @ts-ignore
	// tmplAst.program.body[0].declarations[0].id.name = 'asdf';
	// @ts-ignore
	// console.log(tmplAst.program.body);
	// console.log(print(tmplAst));

	const chunks = splitExpression(expr);
	// console.log(chunks);

	const newProg = b.program([
		b.variableDeclaration('var', [
			b.variableDeclarator(b.identifier('global'), b.objectExpression([])),
		]),
	]);

	let dataNode: DataNode = b.thisExpression();
	if (chunks.filter((v) => v.type === 'code').some((v) => hasFunction(maybeWrapExpr(v.text)))) {
		dataNode = b.identifier('__n8n_data');
		newProg.body.push(
			b.variableDeclaration('var', [b.variableDeclarator(dataNode, b.thisExpression())]),
		);
	}

	if (chunks.length > 2 || chunks[0].text !== '') {
		const parts: ExpressionKind[] = [];
		for (const chunk of chunks) {
			if (chunk.type === 'text') {
				parts.push(b.literal(chunk.text));
			} else {
				const parsed = jsVariablePolyfill(maybeWrapExpr(chunk.text), dataNode)?.[0];
				if (!parsed) {
					throw new Error('BBBBBBBBB');
				}
				const v = b.identifier('v');

				let functionBody = b.blockStatement([
					// v = (<actual expression>)
					b.expressionStatement(
						b.assignmentExpression('=', v, (parsed as namedTypes.ExpressionStatement).expression),
					),
					// Return value or empty string on some falsy values
					// return v || v === 0 || v === false ? v : 0
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

				// console.log(functionBody.body);

				// Turn our expression into a function call with bound this
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
		const parsed = jsVariablePolyfill(maybeWrapExpr(chunks[1].text), dataNode)?.[0];
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

export const executeExpression = (expr: string, data: any, errorFn: (error: Error) => void) => {
	const code = getExpressionCode(expr);
	const fn = new Function('E', code + ';');
	return fn.call(data, errorFn);
};

export class ExpressionEvaluator {
	constructor(public errorHandler: (error: Error) => void) {}

	execute(expr: string, data: any) {
		return executeExpression(expr, data, this.errorHandler);
	}
}

// console.log(getExpressionCode('test {{ test() }}'));
// console.log(getExpressionCode('test {{ test() }}'));
// console.log(getExpressionCode('test {{ [1, 2, 3] }}'));
// console.log(getExpressionCode('test {{ $json.test }}'));
// console.log(getExpressionCode('test {{ test.filter((p) => () => p === $json.toFilter) }}'));
// console.log(getExpressionCode('{{ test2 }}'));
// console.log(getExpressionCode('{{ $json.test }}'));
// console.log(getExpressionCode('{{ { "data": $json.test } }}'));
