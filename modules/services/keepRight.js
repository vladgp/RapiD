import _extend from 'lodash-es/extend';
import _find from 'lodash-es/find';
import _forEach from 'lodash-es/forEach';
import _isEmpty from 'lodash-es/isEmpty';

import rbush from 'rbush';

import { dispatch as d3_dispatch } from 'd3-dispatch';
import { request as d3_request } from 'd3-request';

import { geoExtent } from '../geo';

import {
    utilRebind,
    utilTiler,
    utilQsString
} from '../util';


var tiler = utilTiler();
var dispatch = d3_dispatch('authLoading', 'authDone', 'change', 'loading', 'loaded', 'loadedKeepRight');

var _keepRightCache = { loaded: {}, inflight: {}, keepRight: {}, rtree: rbush()};
var _off;
var _keepRightZoom = 16;

var apiBase = 'https://www.keepright.at/export.php?';


function abortRequest(i) {
    if (i) {
        i.abort();
    }
}


function abortUnwantedRequests(cache, tiles) {
    _forEach(cache.inflight, function(v, k) {
        var wanted = _find(tiles, function(tile) { return k === tile.id; });
        if (!wanted) {
            abortRequest(v);
            delete cache.inflight[k];
        }
    });
}


export default {
    init: function() {
        if (!_keepRightCache) {
            this.reset();
        }

        this.event = utilRebind(this, dispatch, 'on');
    },

    reset: function() {
        _forEach(_keepRightCache.inflight, abortRequest);

        _keepRightCache = { loaded: {}, inflight: {}, keepRight: {}, rtree: rbush()};
    },

    loadKeepRight: function(context, projection, options, callback) {
        options = _extend({ 'format': 'geojson' }, options);
        if (_off) return;

        var cache = _keepRightCache;

        var that = this;
        var path = apiBase +
            'format=' + options.format +
            '&ch=' + options.ch.join() + '&';

        // determine the needed tiles to cover the view
        var tiles = tiler.zoomExtent([_keepRightZoom, _keepRightZoom]).getTiles(projection);

        // abort inflight requests that are no longer needed
        var hadRequests = !_isEmpty(cache.inflight);
        abortUnwantedRequests(cache, tiles);
        if (hadRequests && _isEmpty(cache.inflight)) {
            dispatch.call('loaded');    // stop the spinner
        }

        // issue new requests..
        tiles.forEach(function(tile) {
            if (cache.loaded[tile.id] || cache.inflight[tile.id]) return;
            if (_isEmpty(cache.inflight)) {
                dispatch.call('loading');   // start the spinner
            }

            var rect = tile.extent.rectangle();
            var nextPath = path +
                utilQsString({
                    left: rect[0],
                    bottom: [3],
                    right: rect[2],
                    top: rect[1]
                });


            var options = {}; // TODO: implement

            cache.inflight[tile.id] = that.loadFromAPI(
                nextPath,
                function(err, data) {
                    if (err || !data.features || !data.features.length) return;

                    cache.loaded[tile.id] = true;
                    delete cache.inflight[tile.id];

                    if (callback) {
                        callback(err, _extend({ data: data }, tile));
                    }
                    if (_isEmpty(cache.inflight)) {
                        dispatch.call('loaded');     // stop the spinner
                    }
                },
                options
            );
        });
    },

    loadFromAPI: function(path, callback, options) {
        var cache = _keepRightCache;

        return d3_request(path)
            .mimeType('application/json') // TODO: only have this as a response if the input format is json
            .header('Content-type', 'application/x-www-form-urlencoded')
            .response(function(xhr) {
                return JSON.parse(xhr.responseText);
            })
            .get(function(err, data) {

                var features = data.features.map(function(feature) {
                    var loc = feature.geometry.coordinates;
                    var props = feature.properties;
                    var d = {
                        loc: loc,
                        comment: props.comment || null,
                        description: props.description || '',
                        error_id: props.error_id,
                        error_type: props.error_type,
                        object_id: props.object_id,
                        object_type: props.object_type,
                        schema: props.schema,
                        title: props.title
                    };

                    cache.keepRight[d.error_id] = d;

                    return {
                        minX: loc[0], minY: loc[1], maxX: loc[0], maxY: loc[1], data: d
                    };

                }).filter(Boolean);

                cache.rtree.load(features);
                dispatch.call('loadedKeepRight');

                callback(err, data);
            });
    },


    // get all cached notes covering the viewport
    keepRight: function(projection) {
        var viewport = projection.clipExtent();
        var min = [viewport[0][0], viewport[1][1]];
        var max = [viewport[1][0], viewport[0][1]];
        var bbox = geoExtent(projection.invert(min), projection.invert(max)).bbox();

        return _keepRightCache.rtree.search(bbox)
            .map(function(d) { return d.data; });
    },
};