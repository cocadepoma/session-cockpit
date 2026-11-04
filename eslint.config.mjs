// tsc does the type checks (`pnpm typecheck`); ESLint adds the recommended JavaScript and TypeScript rules.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // Claude Code writes the engine's type files here; they are not ours to lint.
  { ignores: ['.claude-plugin/types/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // JSX compiles to h() and Fragment (tsconfig), so an import of either counts as used.
    languageOptions: { parserOptions: { jsxPragma: 'h', jsxFragmentName: 'Fragment' } },
    rules: {
      // The mod strips terminal escapes and control characters from text on purpose.
      'no-control-regex': 'off',
      // Engine stream handlers (turn.step, process.spawn) are generators by contract, even when one answers without yielding.
      'require-yield': 'off',
    },
  },
);
