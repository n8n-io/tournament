import { getExpressionCode } from './ExpressionBuilder';
import type { ExpressionAnalysis } from './ExpressionBuilder';
import type { TmplDifference } from './Analysis';
import { getTmplDifference } from './Analysis';
export type { TmplDifference } from './Analysis';

const DATA_NODE_NAME = '___n8n_data';
export type ReturnValue = string | null | (() => unknown);

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
		const fn = this.getFunction(expr)[0];
		return fn.call(data, this.errorHandler);
	}
}
