var utility = require('./utility');
var processors = require('./processors');
var getData = utility.getData;
var db = require('./db');
var r = require('./redis');
var redis = r.client;
var jobs = r.jobs;
var kue = r.kue;
var logger = utility.logger;
var generateJob = utility.generateJob;
var async = require('async');
var operations = require('./operations');
var insertMatch = operations.insertMatch;
var queueReq = operations.queueReq;
var fullhistory = require('./tasks/fullhistory');
var updatenames = require('./tasks/updatenames');
var selector = require('./selector');
var domain = require('domain');
var services = {};
var trackedPlayers = {};
var ratingPlayers = {};
process.on('SIGTERM', function() {
    clearActiveJobs(function(err) {
        process.exit(err || 1);
    });
});
process.on('SIGINT', function() {
    clearActiveJobs(function(err) {
        process.exit(err || 1);
    });
});
var d = domain.create();
d.on('error', function(err) {
    console.log(err.stack);
    clearActiveJobs(function(err2) {
        process.exit(err2 || err || 1);
    });
});
d.run(function() {
    build(function() {
        console.log("[WORKER] starting worker");
        startScan();
        jobs.promote();
        jobs.process('api', processors.processApi);
        jobs.process('mmr', processors.processMmr);
        jobs.process('parse', processors.processParse);
        setInterval(fullhistory, 31 * 60 * 1000, function() {});
        setInterval(updatenames, 3 * 60 * 1000, function() {});
        setInterval(build, 10 * 1000, function() {});
        setInterval(apiStatus, 4 * 60 * 1000);
    });
});
//todo set up socket
var express = require('express');
var app = express();
var server = app.listen(process.env.REGISTRY_PORT || 5300, function() {
    var host = server.address().address;
    var port = server.address().port;
    console.log('[WEB] listening at http://%s:%s', host, port);
});
var io = require('socket.io')(server);
io.sockets.on('connection', function(socket) {
    socket.on('retriever', function(data) {
        console.log(data);
        if (!services.retriever) {
            services.retriever = [];
        }
        services.retriever.push(socket);
        //register
        //retriever sends data on initial connect and on heartbeat request
        //todo how to get url for requests?
        var b = [];
        var r = {};
        //each user has a tracker
        //each tracker has a host, requests must go to this socket
        console.log(socket);
        for (var key in data.accounts) {
            b.push(data.accounts[key]);
        }
        for (var key in data.accountToIdx) {
            r[key] = {
                tracker: key
            };
        }
        ratingPlayers = r;
        redis.set("bots", JSON.stringify(b));
        redis.set("ratingPlayers", JSON.stringify(r));
        //friend event?
        //profile event?
        //replay event?
    });
    socket.on('parser', function(data) {
        if (!services.parser) {
            services.parser = [];
        }
        services.parser.push(socket);
        //register
        //parse event?
    });
});

function build(cb) {
    console.log("rebuilding sets");
    db.players.find(selector("tracked"), function(err, docs) {
        if (err) {
            return build(cb);
        }
        var t = {};
        docs.forEach(function(player) {
            t[player.account_id] = true;
        });
        trackedPlayers = t;
        redis.set("trackedPlayers", JSON.stringify(t));
        //check connected clients, request a heartbeat for each
        for (var key in services) {
            services[key].forEach(function(s) {
                s.emit('heartbeat');
                //todo check for expiration
            });
        }
        return cb(err);
    });
}

function startScan() {
    if (process.env.START_SEQ_NUM === "AUTO") {
        var container = generateJob("api_history", {});
        getData(container.url, function(err, data) {
            if (err) {
                return startScan();
            }
            scanApi(data.result.matches[0].match_seq_num);
        });
    }
    else if (process.env.START_SEQ_NUM) {
        scanApi(process.env.START_SEQ_NUM);
    }
    else {
        redis.get("match_seq_num", function(err, result) {
            if (!err && result) {
                scanApi(result);
            }
            else {
                return startScan();
            }
        });
    }
}

function clearActiveJobs(cb) {
    jobs.active(function(err, ids) {
        if (err) {
            return cb(err);
        }
        async.mapSeries(ids, function(id, cb) {
            kue.Job.get(id, function(err, job) {
                if (job) {
                    console.log("requeued job %s", id);
                    job.inactive();
                }
                cb(err);
            });
        }, function(err) {
            console.log("cleared active jobs");
            cb(err);
        });
    });
}
var q = async.queue(function(match, cb) {
    var tracked = false;
    async.each(match.players, function(p, cb) {
        if (p.account_id in trackedPlayers) {
            tracked = true;
        }
        if (p.account_id in ratingPlayers && match.lobby_type === 7) {
            queueReq("mmr", {
                match_id: match.match_id,
                account_id: p.account_id,
                url: ratingPlayers[p.account_id]
            }, function(err) {
                cb(err);
            });
        }
        else {
            cb();
        }
    }, function(err) {
        if (!err) {
            redis.set("match_seq_num", match.match_seq_num);
        }
        if (tracked) {
            insertMatch(match, function(err) {
                cb(err);
            });
        }
        else {
            cb(err);
        }
    });
});

function scanApi(seq_num) {
    var container = generateJob("api_sequence", {
        start_at_match_seq_num: seq_num
    });
    getData(container.url, function(err, data) {
        if (err) {
            return scanApi(seq_num);
        }
        var resp = data.result.matches;
        var next_seq_num = seq_num;
        if (resp.length) {
            next_seq_num = resp[resp.length - 1].match_seq_num + 1;
        }
        logger.info("[API] seq_num:%s, matches:%s, queue:%s", seq_num, resp.length, q.length());
        q.push(resp);
        //wait 100ms for each match less than 100
        var delay = (100 - resp.length) * 100;
        setTimeout(function() {
            scanApi(next_seq_num);
        }, delay);
    });
}

function apiStatus() {
    db.matches.findOne({}, {
        fields: {
            _id: 1
        },
        sort: {
            match_seq_num: -1
        }
    }, function(err, match) {
        var elapsed = (new Date() - db.matches.id(match._id).getTimestamp());
        if (elapsed > 15 * 60 * 1000) {
            redis.set("apiDown", 1);
        }
        else {
            redis.set("apiDown", 0);
        }
    });
}
