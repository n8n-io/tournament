import type { ReturnValue, Tournament } from '.';

export interface ExpressionEvaluator {
	evaluate(code: string, data: unknown): ReturnValue;
	destroy(): void;
}

export interface ExpressionEvaluatorClass {
	new (instance: Tournament): ExpressionEvaluator;
}
