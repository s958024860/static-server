const http = require('http');
const path = require('path');
const config = require('./static/default');
const mime = require('./mime')
const fs = require('fs'); // file system module
const url = require('url');
const utils = require('./utils')

var options = require( "yargs" )
    .option( "p", { alias: "port",  describe: "Port number", type: "number" } )
    .option( "r", { alias: "root", describe: "Static resource directory", type: "string" } )
    .option( "i", { alias: "index", describe: "Default page", type: "string" } )
    .option( "c", { alias: "cachecontrol", default: true, describe: "Use Cache-Control", type: "boolean" } )
    .option( "e", { alias: "expires", default: true, describe: "Use Expires", type: "boolean" } )
    .option( "t", { alias: "etag", default: true, describe: "Use ETag", type: "boolean" } )
    .option( "l", { alias: "lastmodified", default: true, describe: "Use Last-Modified", type: "boolean" } )
    .option( "m", { alias: "maxage", describe: "Time a file should be cached for", type: "number" } )
    .help()
    .alias( "?", "help" )
    .argv;

class StaticServer {

    constructor() {
        this.port = config.port;
        this.root = config.root;
        this.indexPage = config.indexPage;
        this.enableCacheControl = config.cacheControl;
        this.enableExpires = config.expires;
        this.enableETag = config.etag;
        this.enableLastModified = config.lastModified;
        this.maxAge = config.maxAge;
    }

    /**
     * 服务器错误
     * @param err
     * @param res
     */
    respondError(err, res) {
        res.writeHead(500);
        res.end(err)
    }

    /**
     * 获取响应首部。
     * @param stat
     * @returns {string}
     */
    generateETag(stat) {
        const mtime = stat.mtime.getTime().toString(16);
        const size = stat.size.toString(16);
        return `W/"${size}-${mtime}"`;
    }

    /**
     * 根据配置，添加缓存相关的响应首部。
     * @param stat
     * @param res
     */
    setFreshHeaders(stat, res) {
        const lastModified = stat.mtime.toUTCString();
        if (this.enableExpires) {
            const expireTime = (new Date(Date.now() + this.maxAge * 1000)).toUTCString();
            res.setHeader('Expires', expireTime);
        }
        if (this.enableCacheControl) {
            res.setHeader('Cache-Control', `public, max-age=${this.maxAge}`);
        }
        if (this.enableLastModified) {
            res.setHeader('Last-Modified', lastModified);
        }
        // ETag弱验证器，并不能保证缓存文件与服务器上的文件是完全一样的
        if (this.enableETag) {
            res.setHeader('ETag', this.generateETag(stat));
        }
    }

    /**
     * 判断缓存是否仍然新鲜
     * @param reqHeaders
     * @param resHeaders
     * @returns {boolean}
     */
    isFresh(reqHeaders, resHeaders) {
        const  noneMatch = reqHeaders['if-none-match'];
        const  lastModified = reqHeaders['if-modified-since'];
        if (!(noneMatch || lastModified)) return false;
        if(noneMatch && (noneMatch !== resHeaders['etag'])) return false;
        if(lastModified && lastModified !== resHeaders['last-modified']) return false;
        return true;
    }

    /**
     * 是否需要压缩
     * @param pathName
     * @returns {*}
     */
    shouldCompress(pathName) {
        return path.extname(pathName).match(this.zipMatch);
    }

    /**
     * 响应
     * @param pathName
     * @param req
     * @param res
     */
    respond(pathName, req, res) {
        fs.stat(pathName, (err, stat) => {
            if (err) return this.respondError(err, res);
            this.setFreshHeaders(stat, res);
            if (this.isFresh(req.headers, res._headers)) {
                this.responseNotModified(res);
            } else {
                this.responseFile(stat, pathName, req, res);
            }
        });

    }

    responseNotModified(res) {
        res.statusCode = 304;
        res.end();
    }

    compressHandler(readStream, req, res) {
        const acceptEncoding = req.headers['accept-encoding'];
        if (!acceptEncoding || !acceptEncoding.match(/\b(gzip|deflate)\b/)) {
            return readStream;
        } else if (acceptEncoding.match(/\bgzip\b/)) {
            res.setHeader('Content-Encoding', 'gzip');
            return readStream.pipe(zlib.createGzip());
        } else if (acceptEncoding.match(/\bdeflate\b/)) {
            res.setHeader('Content-Encoding', 'deflate');
            return readStream.pipe(zlib.createDeflate());
        }
    }

    getRange(rangeText, totalSize) {
        const matchResults = rangeText.match(/bytes=([0-9]*)-([0-9]*)/);
        let start = parseInt(matchResults[1]);
        let end = parseInt(matchResults[2]);
        if (isNaN(start) && !isNaN(end)) {
            start = totalSize - end;
            end = totalSize - 1;
        } else if (!isNaN(start) && isNaN(end)) {
            end = totalSize - 1;
        }
        return {
            start,
            end
        }
    }

    rangeHandler(pathName, rangeText, totalSize, res) {
        const range = this.getRange(rangeText, totalSize);
        if (range.start > totalSize || range.end > totalSize || range.start > range.end) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${totalSize}`);
            res.end();
            return null;
        } else {
            res.statusCode = 206;
            res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${totalSize}`);
            return fs.createReadStream(pathName, { start: range.start, end: range.end });
        }
    }

    responseFile(stat, pathName, req, res) {
        let readStream;
        res.setHeader('Content-Type', mime.lookup(pathName));
        res.setHeader('Accept-Ranges', 'bytes');
        if (req.headers['range']) {
            readStream = this.rangeHandler(pathName, req.headers['range'], stat.size, res);
            if (!readStream) return;
        } else {
            readStream = fs.createReadStream(pathName);
        }
        if (this.shouldCompress(pathName)) {
            readStream = this.compressHandler(readStream, req, res);
        }
        readStream.pipe(res);
    }


    /**
     * 读取文件并响应
     * @param pathName
     * @param req
     * @param res
     */
    respondFile(pathName, req, res) {
        const fileSteam = fs.createReadStream(pathName);
        res.setHeader('Content-Type', mime.lookup(pathName));
        fileSteam.pipe(res)
    }

    /**
     * 系统盘无此文件
     * @param pathName
     * @param req
     * @param res
     */
    respondNotFound(pathName, req, res) {
        res.writeHead(404, {
            'Content-Type': 'text/html'
        })
        res.end(`<h1>Not Found</h1><p>The requested URL ${req.url} was not found on this server.</p>`);
    }

    respondDirectory (stat, pathName, req, res) {
        const indexPagePath = path.join(pathName, this.indexPage);
        if (fs.existsSync(indexPagePath)) {
            this.respond(indexPagePath, req, res);
        } else {
            fs.readdir(pathName, (err, files) => {
                if (err) {
                    res.wirteHead(500);
                    return res.end(err)
                }
                const requestPath = url.parse(req.url).pathname;
                let content = `<h1>Index of ${requestPath}</h1>`;
                files.forEach(file => {
                    let itemLink = path.join(requestPath, file);
                    const stat = fs.statSync(path.join(pathName, file));
                    if (stat && stat.isDirectory()) {
                        itemLink = path.join(itemLink, '/');
                    }
                    content += `<p><a href='${itemLink}'>${file}</a></p>`;
                });
                res.writeHead(200, {
                    'Content-Type': 'text/html'
                });
                res.end(content);
            });
        }
    }

    respondRedirect(req, res) {
        const location = req.url + '/';
        res.writeHead(301, {
            'Location': location,
            'Content-Type': 'text/html'
        });
        res.end(`Redirecting to <a href='${location}'>${location}</a>`);
    }

    routeHandler(pathName, req, res) {
        fs.stat(pathName, (err, stat) => {
            if (err) {
                this.respondNotFound(pathName, req, res);
            } else {
                console.log(`-----请求地址-------- ${JSON.stringify(url.parse(req.url).pathname)}`);
                var requestUrl = url.parse(req.url).pathname;
                if (utils.hasTrailingSlash(requestUrl) && stat.isDirectory()) {
                    this.respondDirectory(pathName, req, res);
                } else if (stat.isDirectory()) {
                    this.respondRedirect(req, res);
                } else {
                    this.respond(pathName, req, res);
                }
            }
        })
    }

    start() {
        http.createServer((req, res) => {
            const pathName = path.join(this.root, path.normalize(req.url));
            this.routeHandler(pathName, req, res);
            // res.writeHead(200);
            // res.end(`Requeste path: ${pathName}`);
        }).listen(this.port, err => {
            if (err) {
                console.error(err);
                console.info('Failed to start server');
            } else {
                console.info(`Server started on port ${this.port}`);
            }
        })
    }
}

module.exports = StaticServer