const config = {
  description: 'Lightweight lint configuration consumed by scripts/run-eslint.mjs',
  includeExtensions: ['.js', '.mjs'],
  ignore: ['node_modules', '.git', '.vscode', '.idea'],
  rules: {
    'no-var': true,
    'no-trailing-spaces': true,
    eqeqeq: {
      allowNull: true
    }
  }
};

export default config;
