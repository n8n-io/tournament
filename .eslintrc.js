const sharedOptions = require('@n8n_io/eslint-config/shared');

/**
 * @type {import('@types/eslint').ESLint.ConfigData}
 */
module.exports = {
	extends: ['@n8n_io/eslint-config/node'],

	...sharedOptions(__dirname),

	ignorePatterns: ['jest.config.js'],

	rules: {
		'@typescript-eslint/consistent-type-imports': 'error',
	},
};
