/**
 * JSONata utilities.
 */

const bitAnd = function (num, other) {
  return num !== undefined && other !== undefined ? num & other : undefined
}

const bitOr = function (num, other) {
  return num !== undefined && other !== undefined ? num | other : undefined
}

const bitXor = function (num, other) {
  return num !== undefined && other !== undefined ? num ^ other : undefined
}

const bitNot = function (num) {
  return num !== undefined ? ~num >>> 0 : undefined
}

const bitNotSigned = function (num) {
  return num !== undefined ? ~num : undefined
}

const bitShiftLeft = function (num, other = 1) {
  return num !== undefined ? num << other : undefined
}

const bitShiftRight = function (num, other = 1) {
  return num !== undefined ? num >>> other : undefined
}

const bitShiftRightSigned = function (num, other = 1) {
  return num !== undefined ? num >> other : undefined
}

const parseBase = function (str, radix = 10) {
  return str && parseInt(str, radix)
}

const deleteKeys = function (obj, keys) {
  const newObj = Object.assign({}, obj)

  keys.forEach(key => {
    delete newObj[key]
  })

  return newObj
}

const deleteNulls = function (obj) {
  const newObj = {}

  Object.keys(obj).forEach(key => {
    const val = obj[key]
    if (val !== null && val !== '') newObj[key] = val
  })

  return newObj
}

const mapValues = function* (obj, func) {
  const newObj = {}

  const keys = Object.keys(obj)
  for (const key of keys) {
    newObj[key] = yield* func.apply(this, [obj[key], key])
  }

  return newObj
}

const safeName = function (str, lc = true) {
  return (
    str &&
    (lc ? str.replace(/\W/g, '_').toLowerCase() : str.replace(/\W/g, '_'))
  )
}

/**
 * Register a set of standard helper functions.
 */
export function registerHelpers(expr) {
  expr.registerFunction('bitAnd', bitAnd, '<nn:n>')
  expr.registerFunction('bitOr', bitOr, '<nn:n>')
  expr.registerFunction('bitXor', bitXor, '<nn:n>')
  expr.registerFunction('bitNot', bitNot, '<n:n>')
  expr.registerFunction('bitNotSigned', bitNotSigned, '<n:n>')
  expr.registerFunction('bitShiftLeft', bitShiftLeft, '<n,n?:n>')
  expr.registerFunction('bitShiftRight', bitShiftRight, '<n,n?:n>')
  expr.registerFunction('bitShiftRightSigned', bitShiftRightSigned, '<n,n?:n>')
  expr.registerFunction('parseBase', parseBase, '<s,n?:n>')
  expr.registerFunction('deleteKeys', deleteKeys, '<oa<s>:o>')
  expr.registerFunction('deleteNulls', deleteNulls, '<o:o>')
  expr.registerFunction('mapValues', mapValues, '<of:o>')
  expr.registerFunction('safeName', safeName, '<s,b?:s>')
}

exports.registerHelpers = registerHelpers
