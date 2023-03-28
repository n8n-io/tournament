import { parse, visit, types } from 'recast';
import { getOption } from 'recast/lib/util';
import { parse as esprimaParse } from 'esprima-next';
import {
	CatchClauseKind,
	ExpressionKind,
	PatternKind,
	PropertyKind,
	StatementKind,
	VariableDeclaratorKind,
} from 'ast-types/gen/kinds';
import { NodePath } from 'ast-types/lib/node-path';
import { namedTypes } from 'ast-types/gen/namedTypes';
import { builders as b } from 'ast-types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseWithEsprimaNext(source: string, options?: any): any {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
	const ast = esprimaParse(source, {
		loc: true,
		locations: true,
		comment: true,
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		range: getOption(options, 'range', false),
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		tolerant: getOption(options, 'tolerant', true),
		tokens: true,
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		jsx: getOption(options, 'jsx', false),
		sourceType: 'script',
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any);

	return ast;
}

// function assertNever(value: never): value is never {
// 	return true;
// }

const globalIdentifier = b.identifier(
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore
	typeof window !== 'object' ? 'global' : 'window',
);

const buildGlobalSwitch = (node: types.namedTypes.Identifier, dataNode: DataNode) => {
	return b.memberExpression(
		b.conditionalExpression(
			b.binaryExpression('in', b.literal(node.name), dataNode),
			dataNode,
			globalIdentifier,
		),
		b.identifier(node.name),
	);
};

const isInScope = (path: NodePath<types.namedTypes.Identifier>) => {
	let scope = path.scope;
	while (scope !== null) {
		if (scope.declares(path.node.name)) {
			return true;
		}
		scope = scope.parent;
	}
	return false;
};

const polyfillVar = (
	path: NodePath<types.namedTypes.Identifier>,
	dataNode: DataNode,
	force: boolean = false,
) => {
	if (!force) {
		if (isInScope(path)) {
			// console.log('In scope', path.node.name);
			return;
		}
	}
	path.replace(buildGlobalSwitch(path.node, dataNode));
};

export type DataNode = namedTypes.ThisExpression | namedTypes.Identifier;

type ParentKind =
	| ExpressionKind
	| StatementKind
	| PropertyKind
	| PatternKind
	| VariableDeclaratorKind
	| CatchClauseKind;
type CustomPatcher = (
	path: NodePath<types.namedTypes.Identifier>,
	parent: any,
	dataNode: DataNode,
) => void;

const customPatches: Partial<Record<ParentKind['type'], CustomPatcher>> = {
	MemberExpression(path, parent: namedTypes.MemberExpression, dataNode) {
		if (parent.object === path.node) {
			polyfillVar(path, dataNode);
		}
	},
	OptionalMemberExpression(path, parent: namedTypes.OptionalMemberExpression, dataNode) {
		if (parent.object === path.node) {
			polyfillVar(path, dataNode);
		}
	},
	Property(path, parent: namedTypes.Property, dataNode) {
		if (path.node !== parent.value) {
			return;
		}
		const objPattern: namedTypes.ObjectPattern = path.parent?.parent?.node;
		if (!objPattern) {
			return;
		}
		const objParent: VariableDeclaratorKind = path.parent.parent.parent?.node;
		if (!objParent) {
			return;
		}
		if (objParent.type === 'VariableDeclarator' && objParent.id === objPattern) {
			return;
		}

		parent.shorthand = false;
		polyfillVar(path, dataNode);
	},
	AssignmentPattern(path, parent: namedTypes.AssignmentPattern, dataNode) {
		if (parent.right === path.node) {
			polyfillVar(path, dataNode);
		}
	},
	VariableDeclarator(path, parent: namedTypes.VariableDeclarator, dataNode) {
		if (parent.init === path.node) {
			polyfillVar(path, dataNode);
		}
	},
};

export const jsVariablePolyfill = (
	expression: string,
	dataNode: DataNode,
): StatementKind[] | undefined => {
	try {
		const ast = parse(expression, {
			parser: { parse: parseWithEsprimaNext },
		}) as namedTypes.File;

		visit(ast, {
			visitIdentifier(path) {
				this.traverse(path);
				const parent: ParentKind = path.parent.node;

				switch (parent.type) {
					case 'AssignmentPattern':
					case 'Property':
					case 'MemberExpression':
					case 'OptionalMemberExpression':
					case 'VariableDeclarator':
						if (!customPatches[parent.type]) {
							throw new Error(`Couldn\'t find custom patcher for parent type: ${parent.type}`);
						}
						customPatches[parent.type]!(path, parent, dataNode);
						break;
					case 'BinaryExpression':
					case 'UnaryExpression':
					case 'ArrayExpression':
					case 'AssignmentExpression':
					case 'SequenceExpression':
					case 'YieldExpression':
					case 'UpdateExpression':
					case 'LogicalExpression':
					case 'ConditionalExpression':
					case 'NewExpression':
					case 'CallExpression':
					case 'OptionalCallExpression':
					case 'TaggedTemplateExpression':
					case 'TemplateLiteral':
					case 'AwaitExpression':
					case 'ImportExpression':
					case 'ForStatement':
					case 'IfStatement':
					case 'WhileStatement':
					case 'ForInStatement':
					case 'ForOfStatement':
					case 'SwitchStatement':
					case 'ReturnStatement':
					case 'DoWhileStatement':
					case 'ExpressionStatement':
					case 'ForAwaitStatement':
					case 'ThrowStatement':
					case 'WithStatement':
						polyfillVar(path, dataNode);
						break;

					// Do nothing
					case 'Super':
					case 'Identifier':
					case 'ArrowFunctionExpression':
					case 'FunctionDeclaration':
					case 'FunctionExpression':
					case 'ThisExpression':
					case 'ObjectExpression':
					case 'MetaProperty':
					case 'ChainExpression':
					case 'PrivateName':
					case 'ParenthesizedExpression':
					case 'Import':
					case 'VariableDeclaration':
					case 'CatchClause':
					case 'BlockStatement':
					case 'TryStatement':
					case 'EmptyStatement':
					case 'LabeledStatement':
					case 'BreakStatement':
					case 'ContinueStatement':
					case 'DebuggerStatement':
					case 'ImportDeclaration':
					case 'ExportDeclaration':
					case 'ExportAllDeclaration':
					case 'ExportDefaultDeclaration':
					case 'Noop':
					case 'ClassMethod':
					case 'ClassPrivateMethod':
					case 'RestElement':
					case 'ArrayPattern':
					case 'ObjectPattern':
						break;

					// I can't seem to figure out what causes these
					case 'SpreadElementPattern':
					case 'SpreadPropertyPattern':
					case 'ClassPropertyDefinition':
						break;

					// Flow types
					case 'DeclareClass':
					case 'DeclareModule':
					case 'DeclareVariable':
					case 'DeclareFunction':
					case 'DeclareInterface':
					case 'DeclareTypeAlias':
					case 'DeclareOpaqueType':
					case 'DeclareModuleExports':
					case 'DeclareExportDeclaration':
					case 'DeclareExportAllDeclaration':
					case 'InterfaceDeclaration':
					case 'TypeAlias':
					case 'OpaqueType':
					case 'EnumDeclaration':
						break;

					// Typescript types
					case 'TSAsExpression':
					case 'TSTypeParameter':
					case 'TSTypeAssertion':
					case 'TSDeclareMethod':
					case 'TSIndexSignature':
					case 'TSDeclareFunction':
					case 'TSMethodSignature':
					case 'TSEnumDeclaration':
					case 'TSExportAssignment':
					case 'TSNonNullExpression':
					case 'TSPropertySignature':
					case 'TSModuleDeclaration':
					case 'TSParameterProperty':
					case 'TSTypeAliasDeclaration':
					case 'TSInterfaceDeclaration':
					case 'TSImportEqualsDeclaration':
					case 'TSExternalModuleReference':
					case 'TSTypeParameterDeclaration':
					case 'TSCallSignatureDeclaration':
					case 'TSNamespaceExportDeclaration':
					case 'TSConstructSignatureDeclaration':
						break;

					// Literals that can't contain an identifier
					case 'DirectiveLiteral':
					case 'StringLiteral':
					case 'NumericLiteral':
					case 'BigIntLiteral':
					case 'NullLiteral':
					case 'Literal':
					case 'RegExpLiteral':
					case 'BooleanLiteral':
						break;

					// Proposals that are stage 0 or 1
					case 'DoExpression':
					case 'BindExpression':
						break;

					// JSX stuff. We don't support this so just do nothing.
					case 'JSXIdentifier':
					case 'JSXText':
					case 'JSXElement':
					case 'JSXFragment':
					case 'JSXMemberExpression':
					case 'JSXExpressionContainer':
						break;

					// I _think_ these are obsolete features proposed as part of ECMAScript 7.
					// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Deprecated_and_obsolete_features#legacy_generator_and_iterator
					case 'ComprehensionExpression':
					case 'GeneratorExpression':
						polyfillVar(path, dataNode);
						break;

					default:
						console.error(path.parentPath.node.type, path.node.name);
						// assertNever(parent.type);
						break;
				}
			},
		});

		// return print(ast);
		// // @ts-ignore
		return ast.program.body;
	} catch (e) {
		console.error(e);
	}
	return undefined;
};
