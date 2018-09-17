const path = require('path')

const mimeType = {
    'html': 'text/html; charset=UTF-8',
    'js': 'text/javascript; charset=UTF-8',
    'css': 'text/css; charset=UTF-8',
    'xml': 'text/xml',
    'png': 'text/png',
    'json': 'text/json',
    'jpg': 'text/jpg',
    'gif': 'image/gif',
    'ico': 'image/x-icon',
    'jpeg': 'image/jpeg'
}

const lookup = (pathName) => {
    let ext = path.extname(pathName);
    ext = ext.split('.').pop();
    return mimeType[ext] || mimeType['txt'];
}

module.exports = {
    lookup
}