// @ts-ignore
import * as tmpl from '@n8n_io/riot-tmpl';
import { baseFixtures } from './ExpressionFixtures/base';
import { types, parse as recastParse } from 'recast';
import { ExpressionEvaluator } from '@/index';
import { parseWithEsprimaNext } from '@/Parser';

tmpl.brackets.set('{{ }}');
const evaluator = new ExpressionEvaluator((e) => {});

const parse = (code: string): types.ASTNode => {
	const parsed = recastParse(code, {
		parser: { parse: parseWithEsprimaNext },
	}) as types.namedTypes.File;
	return parsed;
};

describe('Expression', () => {
	describe('Test all expression transform fixtures', () => {
		for (const t of baseFixtures) {
			if (!t.tests.some((test) => test.type === 'transform')) {
				continue;
			}
			test(t.expression, () => {
				const expr = t.expression.slice(1);
				const [tournStr] = evaluator.getExpressionCode(expr);
				const tmplStr = tmpl.tmpl.getStr(expr);
				if (!types.astNodesAreEquivalent(parse(tournStr), parse(tmplStr))) {
					console.log('tourn', tournStr);
					console.log('tmpl', tmplStr);
				}
				expect(types.astNodesAreEquivalent(parse(tournStr), parse(tmplStr))).toEqual(true);
			});
		}
	});
});
