import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'target/**',
      'release/**',
      '.cache/**',
      'tmp/**',
      'artifacts/**',
      'src-tauri/gen/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': hooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' },
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
);
