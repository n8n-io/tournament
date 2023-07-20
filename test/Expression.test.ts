import * as tmpl from '@n8n_io/riot-tmpl';

import { baseFixtures } from './ExpressionFixtures/base';
import { Tournament } from '../src/index';
import { isDifferent } from '../src/Differ';

tmpl.brackets.set('{{ }}');
const evaluator = new Tournament(() => {});

describe('Expression', () => {
	describe('Test all expression transform fixtures', () => {
		for (const t of baseFixtures) {
			if (t.expression.trimEnd() === '=') {
				continue;
			}
			test(t.expression, () => {
				const expr = t.expression.slice(1);
				const [tournStr] = evaluator.getExpressionCode(expr);
				const tmplStr = tmpl.tmpl.getStr(expr);
				expect(isDifferent(tmplStr, tournStr)).toEqual(false);
			});
		}
	});
});
