import { joinExpression, splitExpression } from '@/ExpressionSplitter';

describe('tmpl Expression Parser', () => {
	describe('Compatible splitting', () => {
		test('Lone expression', () => {
			expect(splitExpression('{{ "" }}')).toEqual([
				{ type: 'text', text: '' },
				{ type: 'code', text: ' "" ', hasClosingBrackets: true },
			]);
		});

		test('Multiple expression', () => {
			expect(splitExpression('{{ "test".toSnakeCase() }} you have ${{ (100).format() }}.')).toEqual(
				[
					{ type: 'text', text: '' },
					{ type: 'code', text: ' "test".toSnakeCase() ', hasClosingBrackets: true },
					{ type: 'text', text: ' you have $' },
					{ type: 'code', text: ' (100).format() ', hasClosingBrackets: true },
					{ type: 'text', text: '.' },
				],
			);
		});

		test('Unclosed expression', () => {
			expect(splitExpression('{{ "test".toSnakeCase() }} you have ${{ (100).format()')).toEqual([
				{ type: 'text', text: '' },
				{ type: 'code', text: ' "test".toSnakeCase() ', hasClosingBrackets: true },
				{ type: 'text', text: ' you have $' },
				{ type: 'code', text: ' (100).format()', hasClosingBrackets: false },
			]);
		});

		test('Escaped opening bracket', () => {
			expect(splitExpression('test \\{{ no code }}')).toEqual([
				{ type: 'text', text: 'test \\{{ no code }}' },
			]);
		});

		test('Escaped closinging bracket', () => {
			expect(splitExpression('test {{ code.test("\\}}") }}')).toEqual([
				{ type: 'text', text: 'test ' },
				{ type: 'code', text: ' code.test("}}") ', hasClosingBrackets: true },
			]);
		});
	});

	describe('Compatible joining', () => {
		test('Lone expression', () => {
			expect(joinExpression(splitExpression('{{ "" }}'))).toEqual('{{ "" }}');
		});

		test('Multiple expression', () => {
			expect(
				joinExpression(
					splitExpression('{{ "test".toSnakeCase() }} you have ${{ (100).format() }}.'),
				),
			).toEqual('{{ "test".toSnakeCase() }} you have ${{ (100).format() }}.');
		});

		test('Unclosed expression', () => {
			expect(
				joinExpression(splitExpression('{{ "test".toSnakeCase() }} you have ${{ (100).format()')),
			).toEqual('{{ "test".toSnakeCase() }} you have ${{ (100).format()');
		});

		test('Escaped opening bracket', () => {
			expect(joinExpression(splitExpression('test \\{{ no code }}'))).toEqual(
				'test \\{{ no code }}',
			);
		});

		test('Escaped closing bracket', () => {
			expect(joinExpression(splitExpression('test {{ code.test("\\}}") }}'))).toEqual(
				'test {{ code.test("\\}}") }}',
			);
		});
	});
});
