import { Tournament } from '../src/index';

const fnStub = () => {};

describe('ES6 Syntax', () => {
	let t: Tournament;

	beforeAll(() => {
		t = new Tournament(fnStub, '___n8n_data');
	});

	test('arrow functions', () => {
		const result = t.execute('{{ () => 1 }}', {});

		expect(result instanceof Function).toBe(true);
	});

	test.only('arrow function call', () => {
		const result1 = t.execute('{{ () => key }}', { key: 'value' });
		expect(result1).toBeInstanceOf(Function);
		expect((result1 as Function)()).toBe('value');

		const result2 = t.execute('{{ (() => key)() }}', { key: 'value' });
		expect(result2).toBe('value');
	});

	test('interpolation in template literals', () => {
		const result = t.execute('{{ `abc ${num} def` }}', { num: 123 });

		expect(result).toBe('abc 123 def');
	});

	test('spread operator', () => {
		const result = t.execute('{{ Math.max(...[1, 2, 3]) }}', {});

		expect(result).toBe(3);
	});
});
