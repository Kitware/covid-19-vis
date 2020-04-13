/* global geo PolyBool c3 d3 _ */
/* eslint no-unused-vars: 0 */
/* eslint comma-dangle: 0 */

/* This adjusts the requested screen size for mobile devices.  It responds to
 * oreintation changes on Chrome on Android, but not on Firefox on Android. */
function adjustMetaViewport() {
  let minArea = 360 * 540 * 3, minWidth = 550, minHeight = 520;
  let viewport = document.querySelector('meta[name=viewport]');
  if (viewport) {
    document.head.removeChild(viewport);
  }
  let content = 'user-scalable=no';
  viewport = document.createElement('meta');
  viewport.setAttribute('name', 'viewport');
  viewport.setAttribute('content', content);
  document.head.appendChild(viewport);
  if (screen && screen.width * screen.height && screen.width * screen.height < minArea) {
    let scale = Math.max(
      Math.sqrt(minArea / (screen.width * screen.height)),
      minWidth / screen.width,
      minHeight / screen.height
    );
    content += ', width=' + Math.ceil(screen.width * scale);
    document.head.removeChild(viewport);
    viewport = document.createElement('meta');
    viewport.setAttribute('name', 'viewport');
    viewport.setAttribute('content', content);
    document.head.appendChild(viewport);
  }
}

window.onorientationchange = adjustMetaViewport;
adjustMetaViewport();

let map = geo.map({
  node: '#map',
  center: {x: -97, y: 42},
  zoom: 5,
  max: 14
});
/* Got to the continental United States and zoom out a bit */
map.bounds({left: -124.85, top: 49.39, right: -66.88, bottom: 24.39});
map.zoom(map.zoom() - 0.25);
let osmLayer = map.createLayer('osm'); // , {source: 'osm'});
osmLayer.attribution(
  osmLayer.attribution() +
  ' County boundries from <a href="https://eric.clst.org/tech/usgeojson/">US Census data</a>.' +
  ' COVID data from <a href="https://github.com/CSSEGISandData/COVID-19">JHU CSSE</a>.');

let groups = {
  'Kansas City': ['20091', '28059'],
  'New York City': ['36005', '36047', '36061', '36081', '36085']
};

let playing = false, speed = 1, lastspeed, playTimer;

let countyLayer = map.createLayer('feature', {features: ['polygon']});
let dotLayer = map.createLayer('feature', {features: ['marker']});
let markers = dotLayer.createFeature('marker', {primitiveShape: 'sprite'});
countyLayer.visible(false);
let uiLayer = map.createLayer('ui', {zIndex: 3});
let tooltip = uiLayer.createWidget('dom', {position: {x: 0, y: 0}});
let tooltipPosition = tooltip.position;
tooltip.position = (pos, actualValue) => {
  if (pos === undefined && !actualValue) {
    let pos = map.gcsToDisplay(tooltipPosition(undefined, true));
    return {left: pos.x, top: null, right: null, bottom: map.size().height - pos.y};
  }
  return tooltipPosition.call(tooltip, pos, actualValue);
};
let tooltipElem = $(tooltip.canvas()).attr('id', 'tooltip').addClass('hidden');
let tooltipCounty;
let reader = geo.createFileReader('geojsonReader', {'layer': countyLayer});
let counties = {};
let promises = [];
let dateSet = {};
let dateList = [];
let datePos, dateVal;
let useSamples = false;

let chart = null;
function refreshChartData(mode, countyFilter) {
  let series = {}, population = 0;
  Object.entries(countyFilter).forEach(([fips, weight]) => {
    let county = counties[fips];
    Object.entries(county.data).forEach(([date, counts]) => {
      date = +date;
      if (series[date] === undefined) {
        series[date] = {
          confirmed: 0,
          deaths: 0,
        };
      }
      series[date].confirmed += counts.confirmed * weight;
      series[date].deaths += counts.deaths * weight;
    });
    population += county.population * weight;
  });

  let c3data = [
    ['x'],
    ['confirmed'],
    ['deaths'],
  ];

  const logmode = mode.slice(0, 3) === 'log';
  const percapitamode = mode.slice(0, 9) === 'percapita';
  const dailymode = mode.slice(mode.length - 5) === 'daily';

  Object.entries(series)
    .sort((a, b) => a[0] - b[0])
    .forEach((entry, i, data) => {
      const date = new Date(+entry[0]).toISOString().slice(0, 10);
      let confirmed = +entry[1].confirmed;
      let deaths = +entry[1].deaths;
      if (dailymode) {
        const previous = data[Math.max(0, i - 1)];
        confirmed = confirmed - previous[1].confirmed;
        deaths = deaths - previous[1].deaths;
      }

      if (percapitamode) { // per million
        confirmed *= 1e6 / population;
        deaths *= 1e6 / population;
      } else {
        confirmed = Math.ceil(confirmed);
        deaths = Math.ceil(deaths);
      }

      if (logmode) {
        confirmed = Math.max(0, Math.log10(confirmed));
        deaths = Math.max(0, Math.log10(deaths));
      }

      c3data[0].push(date);
      c3data[1].push(confirmed);
      c3data[2].push(deaths);
    });
  return c3data;
}

function loadChart(data) {
  let chartTitle = $('input[type="radio"][value="' + mode + '"]').attr('charttitle');
  chartTitle += ' across Visible Map';
  if (chart === null) {
    chart = c3.generate({
      bindto: '#graph',

      title: {
        text: chartTitle || 'Total Confirmed Cases and Deaths'
      },

      size: {
        width: 540,
        height: 320,
      },

      data: {
        x: 'x',
        columns: data,
        colors: {
          confirmed: '#ff8000',
          deaths: '#000000'
        }
      },

      axis: {
        x: {
          type: 'timeseries',
          padding: {
            left: 0,
          },
          tick: {
            format: '%m/%d',
            outer: false,
          },
        },

        y: {
          min: 0,
          padding: {
            bottom: 0,
          },
          tick: {
            outer: false,
          },
        },
      },
      grid: {
        x: {
          lines: [{value: +dateVal}]
        }
      }
    });
  } else {
    $('.c3-title').text(chartTitle);
    chart.load({
      columns: data,
    });
  }
}

let mode = 'total';
function changeMode(radio) {
  mode = radio.value;

  loadChart(refreshChartData(mode, countiesInArea()), mode);
}

promises.push(reader.read(
  'gz_2010_us_050_00_20m.json',
  function (features) {
    let polygons = features[0];
    let countyList = polygons.data();
    let coordinates = polygons.polygonCoordinates();
    countyList.forEach((county, idx) => {
      let fips = county.properties.GEO_ID.substr(county.properties.GEO_ID.length - 5);
      county.fips = fips;
      if (groups['New York City'].indexOf(fips) >= 0) {
        county.fips = 'NYC';
      }
      if (!counties[fips]) {
        counties[fips] = {};
      }
      counties[fips].name = county.properties.NAME;
      if (!counties[fips].polygons) {
        counties[fips].polygons = [];
      }
      counties[fips].polygons.push(coordinates[idx]);
      // mapouter and mapinner are in web mercator coordinates, maprange is boundingbox
      // range is bb in lat/lon
    });
    features[0].style({fill: false, strokeWidth: 1, strokeColor: 'black', strokeOpacity: 0.1});
    countyLayer.visible(true).draw();
  }
));
promises.push(fetch('https://raw.githubusercontent.com/CSSEGISandData/COVID-19/master/csse_covid_19_data/csse_covid_19_time_series/time_series_covid19_confirmed_US.csv').then(response => {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} - ${response.statusText}`);
  }
  return response.text();
}).then(csv => parseCSSE(csv, 'confirmed')));
promises.push(fetch('https://raw.githubusercontent.com/CSSEGISandData/COVID-19/master/csse_covid_19_data/csse_covid_19_time_series/time_series_covid19_deaths_US.csv').then(response => {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} - ${response.statusText}`);
  }
  return response.text();
}).then(csv => parseCSSE(csv, 'deaths')));
Promise.all(promises).then(() => {
  Object.keys(counties).forEach(fips => {
    let c = counties[fips];
    if (!c.data || !c.population || !c.polygons) {
      // this includes unassigned, "Out of (state)", and other things we probably want to process
      // need to fix Puerto Rico if the data is present
      delete counties[fips];
    }
  });
  counties.NYC = {
    population: 8336817, // CSSE population is odd
    fullname: counties['36061'].fullname,
    data: counties['36061'].data,
    name: counties['36061'].name,
    polygons: counties['36061'].polygons.concat(counties['36005'].polygons).concat(counties['36047'].polygons).concat(counties['36081'].polygons).concat(counties['36085'].polygons)
  };
  // remove the five boroughs from the list
  groups['New York City'].forEach(fips => delete counties[fips]);
  dateList = Object.keys(dateSet).sort();
  Object.keys(dateSet).forEach(k => { dateSet[k] = dateList.indexOf(k); });
  setDatePos(dateList.length - 1);
  makeDots();

  let rates = {};
  Object.values(counties).forEach(c => {
    Object.keys(c.data[dateVal]).forEach(k => {
      let rate = c.data[dateVal][k] / c.population;
      if (!rates[k] || rate > rates[k]) {
        rates[k] = rate;
      }
    });
  });
  countyLayer.createFeature('polygon')
    .data(countyLayer.features()[0].data())
    .position(countyLayer.features()[0].position())
    .polygon(countyLayer.features()[0].polygon())
    .style({
      uniformPolygon: true,
      stroke: false,
      fill: true,
      fillColor: {r: 1, g: 0.5, b: 0},
      fillOpacity: (p, i, d, j) => {
        if (!d.fips || !counties[d.fips]) {
          return 0;
        }
        return (counties[d.fips].data[dateVal].confirmed || 0) / counties[d.fips].population / rates.confirmed;
      }
    })
    .visible($('#county_confirmed').prop('checked'));
  countyLayer.createFeature('polygon')
    .data(countyLayer.features()[0].data())
    .position(countyLayer.features()[0].position())
    .polygon(countyLayer.features()[0].polygon())
    .style({
      uniformPolygon: true,
      stroke: false,
      fill: true,
      fillColor: 'black',
      fillOpacity: (p, i, d, j) => {
        if (!d.fips || !counties[d.fips]) {
          return 0;
        }
        return (counties[d.fips].data[dateVal].deaths || 0) / counties[d.fips].population / rates.deaths;
      }
    })
    .visible($('#county_deaths').prop('checked'));
  countyLayer.features()[0]
    .geoOn(geo.event.feature.mouseon, countyHover)
    .geoOn(geo.event.feature.mouseoff, function (evt) {
      tooltipCounty = null;
      tooltipElem.addClass('hidden');
    });
  $('#scrubber').attr('max', dateList.length - 1);
  updateView();

  // Set up the chart.
  const data = refreshChartData('total', countiesInArea());
  const filt = countiesInArea();
  loadChart(data, 'total');

  d3.select('#graph')
    .style('position', 'absolute');

  map.geoOn(geo.event.pan, _.debounce((evt) => {
    loadChart(refreshChartData(mode, countiesInArea()), mode);
  }, 1000));

  return null;
});

function parseCSSE(csv, datakey) {
  csv = parseCsv(csv);
  let keys = {}, dates = [];
  csv[0].forEach((key, idx) => {
    let date = Date.parse(key);
    if (date) {
      dates.push({date: date, column: idx});
      dateSet[date] = true;
    } else {
      keys[key] = idx;
    }
  });
  csv.forEach((line, idx) => {
    if (!idx) {
      return;
    }
    let fips = '00000' + parseInt(line[keys.FIPS], 10);
    fips = fips.substr(fips.length - 5);
    if (isNaN(parseInt(line[keys.FIPS], 10))) {
      fips = line[keys.FIPS] || line[keys.Admin2];
    }
    if (!counties[fips]) {
      counties[fips] = {};
    }
    counties[fips].fullname = line[keys.Combined_Key];
    if (!counties[fips].data) {
      counties[fips].data = {};
    }
    if (line[keys.Population]) {
      counties[fips].population = parseInt(line[keys.Population], 10);
    }
    dates.forEach(({date, column}) => {
      if (!counties[fips].data[date]) {
        counties[fips].data[date] = {};
      }
      counties[fips].data[date][datakey] = parseInt(line[column], 10);
    });
  });
  return null;
}

function makeDots() {
  useSamples = $('#samples').prop('checked');
  let proportion = useSamples ? +$('#sampling').val() : 1;

  let points = [];
  Object.values(counties).forEach((county, idx) => {
    let range = {min: {}, max: {}};
    for (let i = 0; i < county.polygons.length; i += 1) {
      range.min.x = range.min.x === undefined || county.polygons[i].maprange.min.x < range.min.x ? county.polygons[i].maprange.min.x : range.min.x;
      range.min.y = range.min.y === undefined || county.polygons[i].maprange.min.y < range.min.y ? county.polygons[i].maprange.min.y : range.min.y;
      range.max.x = range.max.x === undefined || county.polygons[i].maprange.max.x > range.max.x ? county.polygons[i].maprange.max.x : range.max.x;
      range.max.y = range.max.y === undefined || county.polygons[i].maprange.max.y > range.max.y ? county.polygons[i].maprange.max.y : range.max.y;
    }
    county.range = range;
    let maxIds = useSamples ? county.population : Object.values(county.data).reduce((val, r) => Math.max(val, r.deaths, r.confirmed), 0);
    for (let i = 0; i < maxIds; i += proportion) {
      let pt;
      let id = i;
      if (proportion !== 1) {
        id += Math.floor(Math.random() * proportion);
        if (id >= county.population) {
          continue;
        }
      }
      while (1) {
        let x = Math.random() * (range.max.x - range.min.x) + range.min.x;
        let y = Math.random() * (range.max.y - range.min.y) + range.min.y;
        pt = {x: x, y: y, id: id, c: county};
        if (county.polygons.some(poly => geo.util.pointInPolygon(pt, poly.mapouter, poly.mapinner, poly.maprange))) {
          break;
        }
      }
      points.push(pt);
    }
  });
  points.sort((a, b) => b.id - a.id);
  markers.data(points);
  markers.gcs(map.gcs());
  markers.style({
    strokeWidth: 0,
    fillOpacity: 0.001
  });
  markers.draw();
  map.scheduleAnimationFrame(updateMarkerStyle);
}

function updateMarkerStyle() {
  let dc = {r: 0, g: 0, b: 0}, cc = {r: 1, g: 0.5, b: 0}, oc = {r: 0, g: 0, b: 1};
  let dop = 1, cop = 0.75, oop = 0.25;
  if (!useSamples) {
    dop = 0.25;
    cop = 0.25;
    oop = 0.0001;
  }
  let data = markers.data(), datalen = data.length, d, c, i, i3;
  let mapper = markers.actors()[0].mapper();
  let radius = mapper.getSourceBuffer('radius'),
      symbol = mapper.getSourceBuffer('symbol'),
      symbolValue = mapper.getSourceBuffer('symbolValue'),
      fillColor = mapper.getSourceBuffer('fillColor'),
      fillOpacity = mapper.getSourceBuffer('fillOpacity');
  if (radius.length < datalen) {
    return;
  }
  for (i = i3 = 0; i < datalen; i += 1, i3 += 3) {
    d = data[i];
    c = d.c.data[dateVal];
    if (d.id < c.deaths) {
      radius[i] = 7; // 9;
      symbol[i] = geo.markerFeature.symbols.star12 * 64;
      symbolValue[i] = 0.75;
      fillColor[i3] = dc.r;
      fillColor[i3 + 1] = dc.g;
      fillColor[i3 + 2] = dc.b;
      fillOpacity[i] = dop;
    } else if (d.id < c.confirmed) {
      radius[i] = 6; // 8;
      symbol[i] = geo.markerFeature.symbols.jack12 * 64;
      symbolValue[i] = 0.25;
      fillColor[i3] = cc.r;
      fillColor[i3 + 1] = cc.g;
      fillColor[i3 + 2] = cc.b;
      fillOpacity[i] = cop;
    } else {
      radius[i] = 5; // 6;
      symbol[i] = geo.markerFeature.symbols.circle * 64;
      symbolValue[i] = 1;
      fillColor[i3] = oc.r;
      fillColor[i3 + 1] = oc.g;
      fillColor[i3 + 2] = oc.b;
      fillOpacity[i] = oop;
    }
  }
  mapper.updateSourceBuffer('radius');
  mapper.updateSourceBuffer('symbol');
  mapper.updateSourceBuffer('symbolValue');
  mapper.updateSourceBuffer('fillColor');
  mapper.updateSourceBuffer('fillOpacity');
  markers.renderer()._render();
}

function setDatePos(pos) {
  pos = (pos + dateList.length) % dateList.length;
  if (pos !== datePos) {
    datePos = pos;
    dateVal = dateList[datePos];
    if (chart) {
      chart.xgrids()[0].value = +dateVal;
      chart.show();
    }
  }
}

function setTime(elem, value) {
  let newtime = elem === undefined && value !== undefined ? parseInt(value, 10) : 0;
  if (elem !== undefined && value) {
    newtime = parseInt(document.querySelector(elem || '#curtime').value, 10);
  } else if (value === undefined) {
    newtime = Date.parse(document.querySelector(elem || '#curtime').value);
    if (dateSet[newtime] !== undefined) {
      newtime = dateSet[newtime];
    } else {
      newtime = datePos; // ignore it -- a search would be better
    }
  }
  let isplaying = playing;
  if (newtime !== datePos) {
    playStop();
    setDatePos(newtime);
    if (isplaying) {
      datePos += dateList.length - 1;
      playStart();
    } else {
      updateView();
    }
  }
}

function updateView() {
  updateMarkerStyle();
  countyLayer.features()[0].modified();
  countyLayer.features()[2].modified();
  countyLayer.features()[3].modified();
  map.draw();
  countyHover();
  $('#scrubber').val(datePos);
  $('#curtime').val(new Date(+dateList[datePos]).toJSON().substr(0, 10));
}

function playStop() {
  playing = false;
  if (playTimer) {
    window.clearTimeout(playTimer);
  }
}

function playStart() {
  if (playTimer) {
    window.clearTimeout(playTimer);
  }
  playing = true;
  setDatePos(datePos + 1);
  if (datePos !== dateList.length - 1) {
    playTimer = window.setTimeout(playStart, 1000 / speed);
  }
  updateView();
}

function playAction(action) {
  switch (action) {
    case 'play':
      speed = parseFloat(document.querySelector('#speed').value);
      speed = isNaN(speed) || speed <= 0 ? 1 : speed;
      if (speed !== lastspeed) {
        playStop();

      }
      if (!playing) {
        lastspeed = speed;
        playStart();
      }
      break;
    case 'step':
      playStop();
      setDatePos(datePos + 1);
      updateView();
      break;
    case 'stop':
      playStop();
      break;
  }
}

function countyHover(evt) {
  if (evt) {
    tooltipCounty = counties[evt.data.fips];
  }
  if (tooltipCounty) {
    let contents = $('<div/>');
    contents.append($('<div class="tooltipCounty_name"/>').text(tooltipCounty.fullname));
    contents.append($('<div class="date"/>').text(new Date(+dateList[datePos]).toJSON().substr(0, 10)));
    contents.append($('<div class="population"/>').text('Population: ' + tooltipCounty.population));
    contents.append($('<div class="confirmed"/>').text('Confirmed: ' + tooltipCounty.data[dateVal].confirmed));
    contents.append($('<div class="deaths"/>').text('Deaths: ' + tooltipCounty.data[dateVal].deaths));
    contents.append($('<div class="confirmed_per"/>').text('Confirmed/1M: ' + (1e6 * tooltipCounty.data[dateVal].confirmed / tooltipCounty.population).toFixed(0)));
    contents.append($('<div class="deaths_per"/>').text('Deaths/1M: ' + (1e6 * tooltipCounty.data[dateVal].deaths / tooltipCounty.population).toFixed(0)));
    if (evt) {
      tooltip.position(evt.mouse.geo);
    }
    tooltipElem.html(contents.html());
  }
  tooltipElem.toggleClass('hidden', !tooltipCounty);
}

/**
 * Compute the area of a polygon.
 *
 * @param {array} points An array of of arrays with two values each.
 * @returns The area of the polygon.
 */
function polygonArea(points) {
  var total = 0, ax, ay, sx, sy;
  for (let i = 0; i < points.length; i += 1) {
    ax = points[i][0];
    ay = points[(i + 1) % points.length][1];
    sx = points[(i + 1) % points.length][0];
    sy = points[i][1];
    total += (ax * ay - sx * sy);
  }
  return Math.abs(total * 0.5);
}

/**
 * Perform an booleamn operation on a set of polygons.
 *
 * @param {string} op One of 'union', 'intersect', or other value PolyBool
 *      supports.
 * @param {number} epsilon Precision for calculations.  In degrees, 1e-9 is
 *      around 0.11 mm in ground distance.
 * @param {array} polygons A list of polygons.  Each polygon is a list of
 *      lines.  Each line is a list of coordinates.  Each coordinate is a list
 *      of [x, y].
 * @returns A single polygon.
 */
function polygonOp(op, epsilon, polygons) {
  op = 'select' + op.charAt(0).toUpperCase() + op.slice(1);
  PolyBool.epsilon(epsilon);
  let seglist = polygons.map(p => PolyBool.segments({regions: p}));
  while (seglist.length > 1) {
    let newlist = [], half = Math.ceil(seglist.length / 2);
    for (let i = 0; i < half; i += 1) {
      let segments = seglist[i];
      if (i + half < seglist.length) {
        let nextseg = seglist[i + half];
        try {
          segments = PolyBool.combine(segments, nextseg);
        } catch (err) {
          segments = PolyBool.segments(PolyBool.polygon(segments));
          nextseg = PolyBool.segments(PolyBool.polygon(nextseg));
          for (let j = 20; j >= 6; j -= 1) {
            PolyBool.epsilon(Math.pow(0.1, j));
            try {
              segments = PolyBool.combine(segments, nextseg);
              break;
            } catch (err) {}
          }
          PolyBool.epsilon(epsilon);
        }
        if (segments.combined) {
          segments.combined = segments.combined.filter(s => Math.abs(s.start[0] - s.end[0]) > epsilon || Math.abs(s.start[1] - s.end[1]) > epsilon);
          segments = PolyBool[op](segments);
        } else {
          console.warn('Failed in polygon functions.');
        }
        segments.segments = segments.segments.filter(s => Math.abs(s.start[0] - s.end[0]) > epsilon || Math.abs(s.start[1] - s.end[1]) > epsilon);
      }
      newlist.push(segments);
    }
    seglist = newlist;
  }
  return PolyBool.polygon(seglist[0]).regions;
}

function countiesInArea(poly) {
  if (!poly) {
    let mapsize = map.size();
    poly = [
      map.displayToGcs({x: 0, y: 0}, null),
      map.displayToGcs({x: mapsize.width, y: 0}, null),
      map.displayToGcs({x: mapsize.width, y: mapsize.height}, null),
      map.displayToGcs({x: 0, y: mapsize.height}, null)
    ];
  }
  let oppoly = [poly.map(v => [v.x, v.y])];
  /* Use feature 2 as it doesn't have stroke */
  let found = countyLayer.features()[2].polygonSearch(poly, {partial: true}, null);
  let fipsCount = {};
  found.found.forEach((p, idx) => {
    let fips = p.fips;
    fipsCount[fips] = (fipsCount[fips] || 0) + 1;
  });
  let result = {};
  found.found.forEach((p, idx) => {
    let fips = p.fips;
    if (!result[fips]) {
      let county = counties[fips];
      if (!county) {
        return;
      }
      if (!county.area) {
        county.oppoly = [];
        county.polygons.forEach(cp => {
          county.oppoly.push(cp.mapouter.map(v => [v.x, v.y]));
          cp.mapinner.forEach(ip => {
            county.oppoly.push(ip.map(v => [v.x, v.y]));
          });
        });
        county.area = county.oppoly.reduce((sum, r) => sum + polygonArea(r), 0);
      }
      let partial = found.extra[found.index[idx]].partial;
      if (partial || county.polygons.length > fipsCount[fips]) {
        let partialPoly = polygonOp('intersect', 1e-9, [oppoly, county.oppoly]);
        let partialArea = partialPoly.reduce((sum, r) => sum + polygonArea(r), 0);
        result[fips] = partialArea / county.area;
      } else {
        result[fips] = 1;
      }
    }
  });
  return result;
}

/* https://gist.github.com/Jezternz/c8e9fafc2c114e079829974e3764db75 */
function parseCsv(strData) {
  const objPattern = new RegExp('(\\,|\\r?\\n|\\r|^)(?:"([^"]*(?:""[^"]*)*)"|([^\\,\\r\\n]*))', 'gi');
  let arrMatches = null, arrData = [[]];
  while (true) {
    arrMatches = objPattern.exec(strData);
    if (!arrMatches) {
      break;
    }
    if (arrMatches[1].length && arrMatches[1] !== ',') {
      arrData.push([]);
    }
    arrData[arrData.length - 1].push(arrMatches[2] ?
      arrMatches[2].replace(new RegExp('""', 'g'), '"') :
      arrMatches[3]);
  }
  return arrData;
}
// EOF
