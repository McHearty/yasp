var request = require('request'),
    winston = require('winston');
var BigNumber = require('big-number').n;
var retrievers = (process.env.RETRIEVER_HOST || "localhost:5100").split(",");
var urllib = require('url');
var transports = [];
if (process.env.NODE_ENV !== "test") {
    transports.push(new(winston.transports.Console)({
        'timestamp': true
    }));
}
var logger = new(winston.Logger)({
    transports: transports
});

function generateJob(type, payload) {
    var api_url = "http://api.steampowered.com";
    var api_key;
    var opts = {
        "api_details": function() {
            return {
                url: api_url + "/IDOTA2Match_570/GetMatchDetails/V001/?key=" + api_key + "&match_id=" + payload.match_id,
                title: [type, payload.match_id].join(),
                type: "api",
                payload: payload
            };
        },
        "api_history": function() {
            return {
                url: api_url + "/IDOTA2Match_570/GetMatchHistory/V001/?key=" + api_key + (payload.account_id ? "&account_id=" + payload.account_id : "") + (payload.matches_requested ? "&matches_requested=" + payload.matches_requested : "") + (payload.hero_id ? "&hero_id=" + payload.hero_id : ""),
                title: [type, payload.account_id].join(),
                type: "api",
                payload: payload
            };
        },
        "api_summaries": function() {
            return {
                url: api_url + "/ISteamUser/GetPlayerSummaries/v0002/?key=" + api_key + "&steamids=" + payload.players.map(function(p) {
                    return convert32to64(p.account_id).toString();
                }).join(),
                title: [type, payload.summaries_id].join(),
                type: "api",
                payload: payload
            };
        },
        "api_sequence": function() {
            return {
                url: api_url + "/IDOTA2Match_570/GetMatchHistoryBySequenceNum/V001/?key=" + api_key + "&start_at_match_seq_num=" + payload.start_at_match_seq_num,
                title: [type, payload.seq_num].join(),
                type: "api"
            };
        },
        "api_heroes": function() {
            return {
                url: api_url + "/IEconDOTA2_570/GetHeroes/v0001/?key=" + api_key + "&language=" + payload.language,
                title: [type, payload.language].join(),
                type: "api",
                payload: payload
            };
        },
        "parse": function() {
            return {
                title: [type, payload.match_id].join(),
                type: type,
                fileName: payload.fileName,
                payload: payload
            };
        },
        "mmr": function() {
            return {
                title: [type, payload.match_id, payload.account_id].join(),
                type: type,
                url: payload.url,
                payload: payload
            };
        }
    };
    return opts[type]();
}

function getData(url, cb) {
    var api_keys = process.env.STEAM_API_KEY.split(",");
    var delay = 1000;
    var parse = urllib.parse(url, true);
    //inject a random retriever
    if (parse.host === "retriever") {
        //todo inject a retriever key
        parse.host = retrievers[Math.floor(Math.random() * retrievers.length)];
    }
    //inject a random key if steam api request
    if (parse.host === "api.steampowered.com") {
        parse.query.key = api_keys[Math.floor(Math.random() * api_keys.length)];
        parse.search = null;
        delay = 1000 / api_keys.length;
    }
    var target = urllib.format(parse);
    logger.info("getData: %s", target);
    return setTimeout(function() {
        request({
            url: target,
            json: true,
            timeout: 30000
        }, function(err, res, body) {
            if (err || res.statusCode !== 200 || !body) {
                if (body && body.error) {
                    //body contained an error (probably from retriever)
                    //non-retryable
                    return cb(body);
                }
                logger.info("retrying: %s", target);
                return getData(url, cb);
            }
            else if (body.result) {
                if (body.result.status === 15 || body.result.error === "Practice matches are not available via GetMatchDetails" || body.result.error === "No Match ID specified" || body.result.error === "Match ID not found") {
                    //user does not have stats enabled or attempting to get private match/invalid id, don't retry
                    //non-retryable
                    return cb(body);
                }
                else if (body.result.error || body.result.status === 2) {
                    //valid response, but invalid data, retry
                    logger.info("invalid data: %s, %s", target, JSON.stringify(body));
                    return getData(url, cb);
                }
            }
            return cb(null, body);
        });
    }, delay);
}

    /*
     * Converts a steamid 64 to a steamid 32
     *
     * Returns a BigNumber
     */
function convert64to32(id) {
        return new BigNumber(id).minus('76561197960265728');
    }
    /*
     * Converts a steamid 64 to a steamid 32
     *
     * Returns a BigNumber
     */
function convert32to64(id) {
    return new BigNumber('76561197960265728').plus(id);
}

function isRadiant(player) {
        return player.player_slot < 127;
    }
    /*
     * Makes sort from a datatables call
     */
function makeSort(order, columns) {
    var sort = {
        match_id: -1
    };
    if (order && columns) {
        sort = {};
        order.forEach(function(s) {
            var c = columns[Number(s.column)];
            if (c) {
                sort[c.data] = s.dir === 'desc' ? -1 : 1;
            }
        });
    }
    return sort;
}

function mergeObjects(merge, val) {
    for (var attr in val) {
        if (val[attr].constructor === Array) {
            merge[attr] = merge[attr].concat(val[attr]);
        }
        else if (typeof val[attr] === "object") {
            mergeObjects(merge[attr], val[attr]);
        }
        else {
            //does property exist?
            if (!merge[attr]) {
                merge[attr] = val[attr];
            }
            else {
                merge[attr] += val[attr];
            }
        }
    }
}

function mode(array) {
    if (array.length == 0) return null;
    var modeMap = {};
    var maxEl = array[0],
        maxCount = 1;
    for (var i = 0; i < array.length; i++) {
        var el = array[i];
        if (modeMap[el] == null) modeMap[el] = 1;
        else modeMap[el] ++;
        if (modeMap[el] > maxCount) {
            maxEl = el;
            maxCount = modeMap[el];
        }
    }
    return maxEl;
}
module.exports = {
    logger: logger,
    generateJob: generateJob,
    getData: getData,
    convert32to64: convert32to64,
    convert64to32: convert64to32,
    isRadiant: isRadiant,
    makeSort: makeSort,
    mergeObjects: mergeObjects,
    mode: mode
};
/*
function getS3Url(match_id, cb) {
    var archiveName = match_id + ".dem.bz2";
    var s3 = new AWS.S3();
    var params = {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: archiveName
    };
    var url;
    try {
        url = s3.getSignedUrl('getObject', params);
        cb(null, url);
    }
    catch (e) {
        logger.info("[S3] %s not in S3", match_id);
        cb(new Error("S3 UNAVAILABLE"));
    }
}
function uploadToS3(data, archiveName, cb) {
    var s3 = new AWS.S3();
    var params = {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: archiveName
    };
    params.Body = data;
    s3.putObject(params, function(err, data) {
        cb(err);
    });
}
*/