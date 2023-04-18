// @ts-ignore
import * as tmpl from '@n8n_io/riot-tmpl';

import { getExpressionCode } from './ExpressionBuilder';
import type { ExpressionAnalysis } from './ExpressionBuilder';

const DATA_NODE_NAME = '___n8n_data';

export class ExpressionEvaluator {
	private _codeCache: Record<string, [Function, ExpressionAnalysis]> = {};

	constructor(
		public errorHandler: (error: Error) => void,
		private _dataNodeName: string = DATA_NODE_NAME,
		private _useCompat: boolean = false,
	) {
		if (_useCompat) {
			tmpl.brackets.set('{{ }}');
			tmpl.tmpl.errorHandler = errorHandler;
		}
	}

	getExpressionCode(expr: string): [string, ExpressionAnalysis] {
		return getExpressionCode(expr, this._dataNodeName);
	}

	private getFunction(expr: string): [Function, ExpressionAnalysis] {
		if (expr in this._codeCache) {
			return this._codeCache[expr];
		}
		const [code, analysis] = this.getExpressionCode(expr);
		const func = new Function('E', code + ';');
		this._codeCache[expr] = [func, analysis];
		return [func, analysis];
	}

	execute(expr: string, data: any) {
		const fn = this.getFunction(expr)[0];
		return fn.call(data, this.errorHandler);
	}

	// If using this you can only have one per runtime due to
	// the fact that we assign the error handler of tmpl on init
	compatExec(expr: string, data: any) {
		const [fn, analysis] = this.getFunction(expr);
		if (analysis.has.function) {
			return fn.call(data, this.errorHandler);
		}
	}
}
