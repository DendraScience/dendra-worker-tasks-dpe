// SEE: http://eslint.org/docs/user-guide/configuring
module.exports = {
  env: {
    mocha: true,
    node: true
  },
  extends: ['standard', 'prettier'],
  plugins: ['import', 'prettier', 'standard'],
  parserOptions: {
    sourceType: 'module'
  },
  rules: {
    'prettier/prettier': 'error'
  },
  globals: {
    app: true,
    assert: true,
    expect: true,
    helper: true,
    main: true,
    path: true,
    tm: true
  }
}
