import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';

export default tseslint.config(
  // Global ignores
  {
    // Ignore build folders and the old JS files from before the TypeScript migration
    ignores: ['dist/**', 'node_modules/**', '_site/**', 'coverage/**', 'index.js', 'index.test.js'],
  },
  // Base ESLint recommended rules
  eslint.configs.recommended,
  // TypeScript recommended rules
  ...tseslint.configs.recommended,
  // Prettier integration (must be last to override conflicting formatting rules)
  eslintPluginPrettierRecommended,
  // Language options (Globals)
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  // Custom rule overrides for your specific project
  {
    rules: {
      // form-rescue uses `any` in DraftData, so we downgrade this rule to a warning or turn it off
      '@typescript-eslint/no-explicit-any': 'off',
      // Useful for unused parameters in callbacks
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
