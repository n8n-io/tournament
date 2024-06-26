import { Tournament } from '../src/index';

const fnStub = () => {};

describe('ES6 Syntax', () => {
	let t: Tournament;

	beforeAll(() => {
		t = new Tournament(fnStub, '___n8n_data');
	});

	test('arrow functions with static data', () => {
		const result = t.execute('{{ () => 1 }}', {});

		expect(result instanceof Function).toBe(true);
		expect((result as Function)()).toBe(1);
	});

	test('arrow functions with dynamic data', () => {
		const result = t.execute('{{ () => key }}', { key: 'value' });

		expect(result instanceof Function).toBe(true);
		expect((result as Function)()).toBe('value');
	});

	test('arrow function immediately invoked', () => {
		const result = t.execute('{{ (() => key)() }}', { key: 'value' });
		expect(result).toBe('value');
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
