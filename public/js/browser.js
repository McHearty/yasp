global.tooltips = require('./tooltips');
global.formatHtml = require('./formatHtml');
global.generateCharts = require('./charts');
global.matchTable = require('./matchTables');
global.playerMatchupTables = require('./playerMatchupTables');
global.playerRecordTables = require('./playerRecordTables');
global.playerMatches = require('./playerMatches');
global.buildMap = require('./map');
global.generateHistograms = require('./histograms');
global.generateActivity = require('./activity');
global.statusHandler = require('./statusHandler');
global.c3 = require('c3');
global.h337 = require('heatmap.js');
global.$ = require('jquery');
global.moment = require('moment');
document.addEventListener('DOMContentLoaded', function() {
    global.tooltips();
    global.formatHtml();
});