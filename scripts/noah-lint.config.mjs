// Focused safety gate for maintained browser adapters. Upstream's full style
// migration is separate; these rules must also cover the legacy JS adapters.
export default [{
    files: ['src/plugins/noah/**/*.{js,ts}'],
    ignores: ['**/*.test.*'],
    rules: {
        'no-eval': 'error',
        'no-implied-eval': 'error',
        'no-new-func': 'error',
        'no-script-url': 'error',
        'no-debugger': 'error',
        'no-constant-condition': 'error'
    }
}];
