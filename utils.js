var utils = {
    hasTrailingSlash: function (path) {
        if (path) {
            return path.toString().charAt(path.length - 1) == '/' ? true : false
        } else {
            return false
        }
    }
}

module.exports = utils