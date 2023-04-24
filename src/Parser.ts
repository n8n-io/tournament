import { parse as esprimaParse } from 'esprima-next';
import type { Config as EsprimaConfig } from 'esprima-next';
import { getOption } from 'recast/lib/util';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseWithEsprimaNext(source: string, options?: any): any {
	try {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
		const ast = esprimaParse(source, {
			loc: true,
			locations: true,
			comment: true,
			range: getOption(options, 'range', false) as boolean,
			tolerant: getOption(options, 'tolerant', true) as boolean,
			tokens: true,
			jsx: getOption(options, 'jsx', false) as boolean,
			sourceType: getOption(options, 'sourceType', 'module') as string,
		} as EsprimaConfig);

		return ast;
	} catch (e) {
		throw new SyntaxError(e.message);
	}
}
