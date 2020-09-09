/**
 * JSONata utilities.
 */

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
    if (!(obj[key] === null || obj[key] === '')) newObj[key] = obj[key]
  })

  return newObj
}

const safeName = function (str, lc = true) {
  return lc ? str.replace(/\W/g, '_').toLowerCase() : str.replace(/\W/g, '_')
}

/**
 * Register a set of standard helper functions.
 */
function registerHelpers(expr) {
  expr.registerFunction('deleteKeys', deleteKeys, '<oa<s>:o>')
  expr.registerFunction('deleteNulls', deleteNulls, '<o:o>')
  expr.registerFunction('safeName', safeName, '<s,b?:s>')
}

exports.registerHelpers = registerHelpers
