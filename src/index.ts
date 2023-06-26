import { getExpressionCode } from './ExpressionBuilder';
import type { ExpressionAnalysis } from './ExpressionBuilder';
import { getTmplDifference, TmplDifference } from './Analysis';
export type { TmplDifference } from './Analysis';
import {
	getQuickJS,
	Scope,
	QuickJSContext,
	QuickJSWASMModule,
	QuickJSHandle,
} from 'quickjs-emscripten';

const DATA_NODE_NAME = '___n8n_data';
export type ReturnValue = string | null | (() => unknown);

let QuickJS: QuickJSWASMModule;
// let context: QuickJSContext;

const loadQuickJS = async () => {
	QuickJS = await getQuickJS();
	// context = QuickJS.newContext();
};
// loadQuickJS()
// 	.then(() => {
// 		console.log('QuickJS loaded');
// 	})
// 	.catch((e) => {
// 		console.error('Failed to load QuickJS', e);
// 	});

const createVMValueObject = (
	context: QuickJSContext,
	scope: Scope,
	type: string,
	value: QuickJSHandle,
): QuickJSHandle => {
	const obj = scope.manage(context.newObject());
	context.setProp(obj, 'type', scope.manage(context.newString(type)));
	context.setProp(obj, 'value', value);
	return obj;
};

const arrayToVMValue = (context: QuickJSContext, scope: Scope, value: unknown[]): QuickJSHandle => {
	const arr = scope.manage(context.newArray());
	for (let i = 0; i < value.length; i++) {
		const v = scope.manage(context.getProp(valueToVMValue(context, scope, value[i]), 'value'));
		context.setProp(arr, i, v);
	}
	return arr;
};

const createFnWrapper = (
	context: QuickJSContext,
	scope: Scope,
	func: Function,
	name: string = '<anonymous proxy function>',
) => {
	return context.newFunction(name, (...values) => {
		// const v = valueToVMValue(context, scope, func(values.map(context.dump)));
		const retValue = func(...values.map(context.dump));
		if (Array.isArray(retValue)) {
			return arrayToVMValue(context, scope, retValue);
		}
		const v = scope.manage(context.getProp(valueToVMValue(context, scope, retValue), 'value'));
		return v;
	});
};

const valueToVMValue = (context: QuickJSContext, scope: Scope, value: unknown): QuickJSHandle => {
	if (value === undefined) {
		return createVMValueObject(context, scope, 'undefined', context.undefined);
	} else if (value === null) {
		return createVMValueObject(context, scope, 'null', context.null);
	} else if (typeof value === 'string') {
		return createVMValueObject(context, scope, 'string', scope.manage(context.newString(value)));
	} else if (typeof value === 'number') {
		return createVMValueObject(context, scope, 'number', scope.manage(context.newNumber(value)));
	} else if (typeof value === 'boolean') {
		return createVMValueObject(context, scope, 'boolean', value ? context.true : context.false);
	} else if (Array.isArray(value)) {
		return createVMValueObject(
			context,
			scope,
			'arrayProxy',
			scope.manage(context.newNumber(value.length)),
		);
	} else if (typeof value === 'object') {
		return createVMValueObject(
			context,
			scope,
			'objectProxy',
			arrayToVMValue(context, scope, Object.keys(value)),
		);
	} else if (typeof value === 'function') {
		return createVMValueObject(
			context,
			scope,
			'function',
			scope.manage(createFnWrapper(context, scope, value, value.name)),
		);
	} else if (typeof value === 'bigint') {
		return createVMValueObject(context, scope, 'bigint', scope.manage(context.newBigInt(value)));
	} else if (typeof value === 'symbol') {
		return createVMValueObject(context, scope, 'symbol', scope.manage(context.newSymbolFor(value)));
	}
	const constructor =
		typeof value === 'object' && 'constructor' in value && typeof value.constructor === 'function'
			? value.constructor.name
			: 'no constructor';
	throw new Error(`Failed to create VM value for unknown type: ${typeof value} (${constructor})`);
};

const bootstrapContext = (
	context: QuickJSContext,
	scope: Scope,
): [(data: unknown) => void, (newScope: Scope) => void, QuickJSHandle] => {
	let data: unknown = {};
	let tempScope: Scope = scope;
	const getterFn = scope.manage(
		context.newFunction('__data_proxy_getter', (...namesHandle) => {
			const names = namesHandle.map((n) => n.consume(context.getString));

			let currentValue: any = data;
			for (const name of names) {
				if (!(name in currentValue)) {
					return context.undefined;
				}
				const value = currentValue[name];
				if (typeof value === 'object') {
					currentValue = value;
					continue;
				}
				currentValue = value;
				break;
			}
			return valueToVMValue(context, tempScope, currentValue);
		}),
	);
	context.setProp(context.global, '__data_proxy_getter', getterFn);

	const consoleObj = scope.manage(context.newObject());
	const consoleLogFn = scope.manage(
		context.newFunction('log', (...values) => {
			console.log(values.map(context.dump));
		}),
	);
	context.setProp(consoleObj, 'log', consoleLogFn);
	context.setProp(context.global, 'console', consoleObj);

	const createProxy = scope.manage(
		context.unwrapResult(
			context.evalCode(
				`
const createArrayProxy = (stack, length) => {
	const cache = {};
	return new Proxy(new Array(length), {
		get(target, p) {
			if (p in cache) {
				return cache[p];
			}
			const obj = globalThis.__data_proxy_getter(...stack, p);
			let value = obj.value;
			if (obj.type === 'objectProxy') {
				value = createObjectProxy([...stack, p], obj.value);
			} else if (object.type === 'arrayProxy') {
				value = createArrayProxy([...stack, p], obj.value);
			}
			cache[p] = value;
			return value;
		},
		set() {},
		defineProperty() {},
		setPrototypeOf() {},
	});
};
const createObjectProxy = (stack, keys) => {
	const cache = {};
	return new Proxy(
		{},
		{
			get(target, p) {
				if (p in cache) {
					return cache[p];
				}
				const obj = globalThis.__data_proxy_getter(...stack, p);
				let value = obj.value;
				if (obj.type === 'objectProxy') {
					value = createObjectProxy([...stack, p], obj.value);
				} else if (obj.type === 'arrayProxy') {
					value = createArrayProxy([...stack, p], obj.value);
				}
				console.log('geto', p, value, obj.type);
				cache[p] = value;
				return value;
			},
			has(target, p) {
				return keys.includes(p);
			},
			ownKeys(target) {
				return keys;
			},
			set() {},
			defineProperty() {},
			setPrototypeOf() {},
		},
	);
};
createObjectProxy;
`,
				'dataproxy.js',
			),
		),
	);
	const setData = (newData: unknown) => (data = newData);
	const setScope = (newScope: Scope) => (scope = newScope);

	return [setData, setScope, createProxy];
};

const executeInQuickJS = (expr: string, data: unknown): ReturnValue => {
	if (!QuickJS) {
		console.error('QuickJS not initialised');
		throw new Error('QuickJS not initialised');
	}

	const scope = new Scope();

	const context = scope.manage(QuickJS.newContext());
	const [setData, setScope, createProxy] = bootstrapContext(context, scope);
	const tempScope = new Scope();
	setData(data);
	setScope(tempScope);
	const proxy = tempScope.manage(
		context.unwrapResult(
			context.callFunction(
				createProxy,
				context.undefined,
				arrayToVMValue(context, tempScope, []),
				arrayToVMValue(context, tempScope, Object.keys(data as any)),
			),
		),
	);

	const errorFunc = scope.manage(
		context.newFunction('E', (eValue, thisValue) => {
			console.error('E called with:', context.dump(eValue), context.dump(thisValue));
		}),
	);

	const funcConstructor = context.getProp(context.global, 'Function');
	const newFunc = scope.manage(
		context.unwrapResult(
			context.callFunction(
				funcConstructor,
				context.undefined,
				scope.manage(context.newString('E')),
				scope.manage(context.newString(expr)),
			),
		),
	);
	funcConstructor.dispose();

	// for (let i = 0; i < 10000; i++) {
	// 	context.unwrapResult(context.callFunction(newFunc, proxy, errorFunc)).consume(() => {});
	// }
	const ret = context.unwrapResult(context.callFunction(newFunc, proxy, errorFunc));
	const value = context.dump(ret);
	ret.dispose();
	tempScope.dispose();
	scope.dispose();
	console.log('aaa', expr, data, value);
	return value;
};

export class Tournament {
	private _codeCache: Record<string, [Function, ExpressionAnalysis]> = {};

	constructor(
		public errorHandler: (error: Error) => void = () => {},
		private _dataNodeName: string = DATA_NODE_NAME,
		public tmplDiffReporter: (diff: TmplDifference) => void = () => {},
	) {}

	getExpressionCode(expr: string): [string, ExpressionAnalysis] {
		return getExpressionCode(expr, this._dataNodeName);
	}

	tmplDiff(expr: string) {
		const diff = getTmplDifference(expr, this._dataNodeName);
		if (!diff.same) {
			this.tmplDiffReporter(diff);
		}
	}

	// @ts-expect-error
	private getFunction(expr: string): [Function, ExpressionAnalysis] {
		if (expr in this._codeCache) {
			return this._codeCache[expr];
		}
		const [code, analysis] = this.getExpressionCode(expr);
		const func = new Function('E', code + ';');
		this._codeCache[expr] = [func, analysis];
		return [func, analysis];
	}

	execute(expr: string, data: unknown): ReturnValue {
		// This is to match tmpl. This will only really happen if
		// an empty expression is passed in.
		if (!expr) {
			return expr;
		}
		return executeInQuickJS(this.getExpressionCode(expr)[0], data);
		// const fn = this.getFunction(expr)[0];
		// return fn.call(data, this.errorHandler);
	}
}

// const tourn = new Tournament();

loadQuickJS()
	.then(() => {
		console.log('QuickJS loaded');
		// console.log('executing');
		// console.log(
		// 	'code',
		// 	tourn.getExpressionCode(
		// 		`test {{ testValue.testFn(testValue.test) }} {{ testValue.testFn([1, 2, 3, 4, 'a']) }}`,
		// 	)[0],
		// );
		// console.time('exec');
		// console.log(
		// 	executeInQuickJS(
		// 		tourn.getExpressionCode(
		// 			`test {{ testValue.testFn(testValue.test) }} {{ testValue.testFn([1, 2, 3, 4, 'a']) }}`,
		// 		)[0],
		// 		{
		// 			testValue: {
		// 				test: 1234,
		// 				testFn: (something: any) => {
		// 					console.log('testFn', something);
		// 					return something;
		// 				},
		// 			},
		// 		},
		// 	),
		// );
		// console.timeEnd('exec');
		// console.time('exec2');
		// for (let i = 0; i < 10000; i++) {
		// 	tourn.execute(
		// 		`test {{ testValue.testFn(testValue.test) }} {{ testValue.testFn([1, 2, 3, 4]) }}`,
		// 		{
		// 			testValue: {
		// 				test: 1234,
		// 				testFn: (something: any) => {
		// 					// console.log('testFn', something);
		// 					return something;
		// 				},
		// 			},
		// 		},
		// 	);
		// }
		// console.timeEnd('exec2');
		// console.log(executeInQuickJS('return Object.keys(this)', { testValue: 1234 }));
	})
	.catch((e) => {
		console.error('Failed to load QuickJS');
		throw e;
	});
