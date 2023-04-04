import { getExpressionCode } from './ExpressionBuilder';

const DATA_NODE_NAME = '___n8n_data';

export class ExpressionEvaluator {
	private _codeCache: Record<string, Function> = {};

	constructor(
		public errorHandler: (error: Error) => void,
		private _dataNodeName: string = DATA_NODE_NAME,
	) {}

	getExpressionCode(expr: string) {
		return getExpressionCode(expr, this._dataNodeName);
	}

	private getFunction(expr: string) {
		if (expr in this._codeCache) {
			return this._codeCache[expr];
		}
		const code = this.getExpressionCode(expr);
		return new Function('E', code + ';');
	}

	execute(expr: string, data: any) {
		console.log(expr);
		const fn = this.getFunction(expr);
		return fn.call(data, this.errorHandler);
	}
}
