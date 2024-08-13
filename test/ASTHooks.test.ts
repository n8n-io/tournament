import type { ExpressionStatement } from 'esprima-next';
import { type ASTAfterHook, type ASTBeforeHook, Tournament } from '../src';

describe('AST Hooks', () => {
	test('Before hooks are called before variable expansion', () => {
		const hook: ASTBeforeHook = (ast) => {
			expect(ast.program.body).toHaveLength(1);
			expect(ast.program.body[0].type).toBe('ExpressionStatement');
			expect((ast.program.body[0] as ExpressionStatement).expression.type).toBe('Identifier');
		};

		const t = new Tournament(() => {}, undefined, undefined, { before: [hook], after: [] });
		expect(t.execute('{{ test }}', { test: 1 })).toBe(1);
	});

	test('After hooks are called after variable expansion', () => {
		const hook: ASTAfterHook = (ast) => {
			expect(ast.type).toBe('ExpressionStatement');
			expect((ast as ExpressionStatement).expression.type).toBe('MemberExpression');
		};

		const t = new Tournament(() => {}, undefined, undefined, { before: [], after: [hook] });
		expect(t.execute('{{ test }}', { test: 1 })).toBe(1);
	});
});
