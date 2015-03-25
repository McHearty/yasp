var utility = require('./utility');
var mode = utility.mode;
var isRadiant = utility.isRadiant;
var mergeObjects = utility.mergeObjects;
var constants = require('./constants.json');

function generatePositionData(d, p) {
    //d, a hash of keys to process
    //p, a player containing keys with values as position hashes
    //stores the resulting arrays in the keys of d
    //64 is the offset of x and y values
    //subtracting y from 127 inverts from bottom/left origin to top/left origin
    for (var key in d) {
        var t = [];
        for (var x in p[key]) {
            for (var y in p[key][x]) {
                t.push({
                    x: Number(x) - 64,
                    y: 127 - (Number(y) - 64),
                    value: p[key][x][y]
                });
            }
        }
        d[key] = t;
    }
    return d;
}

function computeMatchData(match) {
    //for aggregation, want undefined fields for invalids, aggregator counts toward n unless undefined
    //for display, want everything to be present to avoid template crash
    //v4 matches need patching, patching produces v5 data with some undefined fields
    if (!match.parsed_data || !match.parsed_data.version || match.parsed_data.version < 4) {
        //console.log("parse data too old, nulling");
        match.parsed_data = null;
    }
    else if (match.parsed_data && match.parsed_data.version === 4) {
        //console.log("patching v4 data");
        patchLegacy(match);
    }
    else {
        //console.log("valid data %s", match.parsed_data.version);
    }
    //add a parsedplayer property to each player, and compute more stats
    match.players.forEach(function(player, ind) {
        player.isRadiant = isRadiant(player);
        var p = {};
        if (match.parsed_data) {
            //mapping 0 to 0, 128 to 5, etc.
            var parseSlot = player.player_slot % (128 - 5);
            p = match.parsed_data.players[parseSlot];
            //removeF meepo/meepo kills
            if (player.hero_id === 82) {
                p.kills_log = p.kills_log.filter(function(k) {
                    k.key !== "npc_dota_hero_meepo";
                });
            }
            if (p.kills) {
                p.neutral_kills = 0;
                p.tower_kills = 0;
                p.courier_kills = 0;
                for (var key in p.kills) {
                    if (key.indexOf("npc_dota_neutral") === 0) {
                        p.neutral_kills += p.kills[key];
                    }
                    if (key.indexOf("_tower") !== -1) {
                        p.tower_kills += p.kills[key];
                    }
                    if (key.indexOf("courier") !== -1) {
                        p.courier_kills += p.kills[key];
                    }
                }
            }
            if (p.chat) {
                p.chat_message_count = p.chat.length;
                //count ggs
                p.gg_count = p.chat.filter(function(c) {
                    return c.key.indexOf("gg") === 0;
                }).length;
            }
            if (p.buyback_log) {
                p.buyback_count = p.buyback_log.length;
            }
            if (p.item_uses) {
                p.observer_uses = p.item_uses.ward_observer || 0;
                p.sentry_uses = p.item_uses.ward_sentry || 0;
            }
            if (p.gold) {
                //lane efficiency: divide 10 minute gold by static amount based on standard creep spawn
                p.lane_efficiency = (p.gold[10] || 0) / (43 * 60 + 48 * 20 + 74 * 2);
            }
            //convert position hashes to heatmap array of x,y,value
            var d = {
                "obs": true,
                "sen": true,
                //"pos": true,
                "lane_pos": true
            };
            p.posData = generatePositionData(d, p);
            //p.explore = p.posData.pos.length / 128 / 128;
            //compute lanes
            var lanes = [];
            for (var i = 0; i < p.posData.lane_pos.length; i++) {
                var dp = p.posData.lane_pos[i];
                for (var j = 0; j < dp.value; j++) {
                    lanes.push(constants.lanes[dp.y][dp.x]);
                }
            }
            if (lanes.length) {
                p.lane = mode(lanes);
                var radiant = player.isRadiant;
                var lane_roles = {
                    "1": function() {
                        //bot
                        return radiant ? "Safe" : "Off";
                    },
                    "2": function() {
                        //mid
                        return "Mid";
                    },
                    "3": function() {
                        //top
                        return radiant ? "Off" : "Safe";
                    },
                    "4": function() {
                        //rjung
                        return "Jungle";
                    },
                    "5": function() {
                        //djung
                        return "Jungle";
                    }
                };
                p.lane_role = lane_roles[p.lane] ? lane_roles[p.lane]() : undefined;
            }
            //compute hashes of purchase time sums and counts from logs
            p.purchase_time = {};
            p.purchase_time_count = {};
            for (var i = 0; i < p.purchase_log.length; i++) {
                var k = p.purchase_log[i].key;
                var time = p.purchase_log[i].time;
                if (!p.purchase_time[k]) {
                    p.purchase_time[k] = 0;
                    p.purchase_time_count[k] = 0;
                }
                p.purchase_time[k] += time;
                p.purchase_time_count[k] += 1;
            }
        }
        player.parsedPlayer = p;
    });
    match.player_win = (isRadiant(match.players[0]) === match.radiant_win); //did the player win?
}

function aggregator(matches, fields) {
    var types = {
        "start_time": function(key, m, p) {
            agg(key, m.start_time, m);
        },
        "duration": function(key, m, p) {
            agg(key, m.duration, m);
        },
        "cluster": function(key, m, p) {
            agg(key, m.cluster, m);
        },
        "first_blood_time": function(key, m, p) {
            agg(key, m.first_blood_time, m);
        },
        "lobby_type": function(key, m, p) {
            agg(key, m.lobby_type, m);
        },
        "game_mode": function(key, m, p) {
            agg(key, m.game_mode, m);
        },
        "hero_id": function(key, m, p) {
            agg(key, p.hero_id, m);
        },
        "kills": function(key, m, p) {
            agg(key, p.kills, m);
        },
        "deaths": function(key, m, p) {
            agg(key, p.deaths, m);
        },
        "assists": function(key, m, p) {
            agg(key, p.assists, m);
        },
        "last_hits": function(key, m, p) {
            agg(key, p.last_hits, m);
        },
        "denies": function(key, m, p) {
            agg(key, p.denies, m);
        },
        "gold_per_min": function(key, m, p) {
            agg(key, p.gold_per_min, m);
        },
        "xp_per_min": function(key, m, p) {
            agg(key, p.xp_per_min, m);
        },
        "hero_damage": function(key, m, p) {
            agg(key, p.hero_damage, m);
        },
        "tower_damage": function(key, m, p) {
            agg(key, p.tower_damage, m);
        },
        "hero_healing": function(key, m, p) {
            agg(key, p.hero_healing, m);
        },
        "leaver_status": function(key, m, p) {
            agg(key, p.leaver_status, m);
        },
        "isRadiant": function(key, m, p) {
            agg(key, isRadiant(p), m);
        },
        "stuns": function(key, m, p) {
            agg(key, p.parsedPlayer.stuns, m);
        },
        "lane": function(key, m, p) {
            agg(key, p.parsedPlayer.lane, m);
        },
        "lane_role": function(key, m, p) {
            agg(key, p.parsedPlayer.lane_role, m);
        },
        //lifetime ward positions
        "obs": function(key, m, p) {
            agg(key, p.parsedPlayer.obs, m);
        },
        "sen": function(key, m, p) {
            agg(key, p.parsedPlayer.sen, m);
        },
        //lifetime rune counts
        "runes": function(key, m, p) {
            agg(key, p.parsedPlayer.runes, m);
        },
        //lifetime item uses
        "item_uses": function(key, m, p) {
            agg(key, p.parsedPlayer.item_uses, m);
        },
        //track sum of purchase times and counts to get average build time
        "purchase_time": function(key, m, p) {
            agg(key, p.parsedPlayer.purchase_time, m);
        },
        "purchase_time_count": function(key, m, p) {
            agg(key, p.parsedPlayer.purchase_time_count, m);
        },
        "purchase": function(key, m, p) {
            agg(key, p.parsedPlayer.purchase, m);
        },
        "kills_count": function(key, m, p) {
            agg(key, p.parsedPlayer.kills, m);
        },
        "gold_reasons": function(key, m, p) {
            agg(key, p.parsedPlayer.gold_reasons, m);
        },
        "xp_reasons": function(key, m, p) {
            agg(key, p.parsedPlayer.xp_reasons, m);
        },
        "ability_uses": function(key, m, p) {
            agg(key, p.parsedPlayer.ability_uses, m);
        },
        "hero_hits": function(key, m, p) {
            agg(key, p.parsedPlayer.hero_hits, m);
        },
        "courier_kills": function(key, m, p) {
            agg(key, p.parsedPlayer.courier_kills, m);
        },
        "tower_kills": function(key, m, p) {
            agg(key, p.parsedPlayer.tower_kills, m);
        },
        "neutral_kills": function(key, m, p) {
            agg(key, p.parsedPlayer.neutral_kills, m);
        },
        "chat_message_count": function(key, m, p) {
            agg(key, p.parsedPlayer.chat_message_count, m);
        },
        "gg_count": function(key, m, p) {
            agg(key, p.parsedPlayer.gg_count, m);
        },
        "buyback_count": function(key, m, p) {
            agg(key, p.parsedPlayer.buyback_count, m);
        },
        "observer_uses": function(key, m, p) {
            agg(key, p.parsedPlayer.observer_uses, m);
        },
        "sentry_uses": function(key, m, p) {
            agg(key, p.parsedPlayer.sentry_uses, m);
        }
    };
    var aggData = {};
    fields = fields || types;
    for (var type in fields) {
        aggData[type] = {
            sum: 0,
            min: Number.MAX_VALUE,
            max: 0,
            max_match: null,
            n: 0,
            counts: {},
        };
    }
    for (var i = 0; i < matches.length; i++) {
        var m = matches[i];
        var p = m.players[0];
        for (var type in fields) {
            if (types[type]) {
                types[type](type, m, p);
            }
        }
    }
    return aggData;

    function agg(key, value, match) {
        var m = aggData[key];
        if (typeof value === "undefined") {
            return;
        }
        m.n += 1;
        if (typeof value === "object") {
            utility.mergeObjects(m.counts, value);
        }
        else {
            if (!m.counts[value]) {
                m.counts[value] = 0;
            }
            m.counts[value] += 1;
            m.sum += (value || 0);
            if (value < m.min) {
                m.min = value;
            }
            if (value > m.max) {
                m.max = value;
                m.max_match = match;
            }
        }
    }
}

function filter(matches, filters) {
        console.log(filters);
        //accept a hash of filters, run all the filters in the hash in series
        var filtered = [];
        for (var key in filters) {
            for (var i = 0; i < matches.length; i++) {
                if (key==="balanced") {
                    if (constants.modes[matches[i].game_mode].balanced && constants.lobbies[matches[i].lobby_type].balanced) {
                        filtered.push(matches[i]);
                    }
                }
                else if (key==="win") {
                    if (isRadiant(matches[i].players[0]) === matches[i].radiant_win) {
                        filtered.push(matches[i]);
                    }
                }
                else if (key==="hero_id") {
                    if (matches[i].players[0].hero_id === Number(filters["hero_id"])) {
                        filtered.push(matches[i]);
                    }
                }
                else {
                    filtered.push(matches[i]);
                }
            }
            matches = filtered.slice(0);
            filtered = [];
        }
        return matches;
    }
    //deprecated v4 functions
function mergeMatchData(match) {
    var heroes = match.parsed_data.heroes;
    //loop through all units
    //look up corresponding hero_id
    //hero if can find in constants
    //find player slot associated with that unit(hero_to_slot)
    //merge into player's primary unit
    //if not hero attempt to associate with a hero
    for (var key in heroes) {
        var primary = getAssociatedHero(key, heroes);
        if (key !== primary) {
            //merge the objects into primary, but not with itself
            mergeObjects(heroes[primary], heroes[key]);
        }
    }
    return match;
}

function getAssociatedHero(unit, heroes) {
    //assume all illusions belong to that hero
    if (unit.slice(0, "illusion_".length) === "illusion_") {
        unit = unit.slice("illusion_".length);
    }
    //attempt to recover hero name from unit
    if (unit.slice(0, "npc_dota_".length) === "npc_dota_") {
        //split by _
        var split = unit.split("_");
        //get the third element
        var identifiers = [split[2], split[2] + "_" + split[3]];
        identifiers.forEach(function(id) {
            //append to npc_dota_hero_, see if matches
            var attempt = "npc_dota_hero_" + id;
            if (heroes[attempt]) {
                unit = attempt;
            }
        });
    }
    return unit;
}

function patchLegacy(match) {
    mergeMatchData(match);
    match.players.forEach(function(player, i) {
        var hero = constants.heroes[player.hero_id];
        var parsedHero = match.parsed_data.heroes[hero.name];
        var parseSlot = player.player_slot % (128 - 5);
        var parsedPlayer = match.parsed_data.players[parseSlot];
        //get the data from the old heroes hash
        parsedPlayer.purchase = parsedHero.itembuys;
        parsedPlayer.buyback_log = parsedPlayer.buybacks;
        parsedPlayer.ability_uses = parsedHero.abilityuses;
        parsedPlayer.item_uses = parsedHero.itemuses;
        parsedPlayer.gold_reasons = parsedHero.gold_log;
        parsedPlayer.xp_reasons = parsedHero.xp_log;
        parsedPlayer.damage = parsedHero.damage;
        parsedPlayer.hero_hits = parsedHero.hero_hits;
        parsedPlayer.purchase_log = parsedHero.timeline;
        parsedPlayer.kills_log = parsedHero.herokills;
        parsedPlayer.kills = parsedHero.kills;
        parsedPlayer.times = match.parsed_data.times;
        parsedPlayer.chat = [];
        //fill the chat for each player
        match.parsed_data.chat.forEach(function(c) {
            c.key = c.text;
            if (c.slot === parseSlot) {
                parsedPlayer.chat.push(c);
            }
        });
        //remove recipes
        /*
        parsedPlayer.purchase_log.forEach(function(p,i){
            if(p.key.indexOf("recipe_")===0){
                parsedPlayer.purchase_log.splice(i,1);
            }
        });
        */
        //console.log('completed %s', match.match_id, parseSlot, i);
    });
}
module.exports = {
    filter: filter,
    aggregator: aggregator,
    computeMatchData: computeMatchData,
    generatePositionData: generatePositionData
};