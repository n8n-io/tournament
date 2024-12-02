import { splitExpression } from '../src/ExpressionSplitter';

describe('splitExpression', () => {
	test('should handle escaping backslashes before double opening curly braces', () => {
		const expr = 'C:\\\\Users\\\\Administrator\\\\Desktop\\\\abc\\\\{{ $json.files[0].fileName }}';
		const result = splitExpression(expr);

		expect(result).toEqual([
			{
				type: 'text',
				text: 'C:\\Users\\Administrator\\Desktop\\abc\\',
			},
			{
				type: 'code',
				text: ' $json.files[0].fileName ',
				hasClosingBrackets: true,
			},
		]);
	});
});
