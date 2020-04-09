/* global geo */
/* eslint no-unused-vars: 0 */

var map = geo.map({
  node: '#map',
  center: {x: -97, y: 42},
  zoom: 5
});
var osmLayer = map.createLayer('osm'); // , {source: 'osm'});
osmLayer.attribution(
  osmLayer.attribution() +
  ' County boundries from <a href="https://eric.clst.org/tech/usgeojson/">US Census data</a>.' +
  ' COVID data from <a href="https://github.com/CSSEGISandData/COVID-19">JHU CSSE</a>.');

var groups = {
  'Kansas City': ['20091', '28059'],
  'New York City': ['36005', '36047', '36061', '36081', '36085']
};

var playing = false, speed = 1, lastspeed, playTimer;

var countyLayer = map.createLayer('feature', {features: ['polygon']});
var dotLayer = map.createLayer('feature', {features: ['marker']});
var markers = dotLayer.createFeature('marker', {primitiveShape: 'sprite'});
countyLayer.visible(false);
var reader = geo.createFileReader('geojsonReader', {'layer': countyLayer});
var counties = {};
var promises = [];
var dateSet = {};
var dateList = [];
var datePos, dateVal;

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
    features[0].style({fill: false, strokeWidth: 1, strokeColor: 'blue', strokeOpacity: 0.1});
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
    var c = counties[fips];
    if (!c.data || !c.population || !c.polygons) {
      // this includes unassigned, "Out of (state)", and other things we probably want to process
      // need to fix Puerto Rico if the data is present
      delete counties[fips];
      // console.log(fips, c);
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
  datePos = dateList.length - 1;
  dateVal = dateList[datePos];

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
    });
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
    });

  $('#scrubber').attr('max', dateList.length - 1);
  updateView();

  window.parent.counties = counties;
  window.parent.dateSet = dateSet;

  // Chart visualization
  (function() {
    const chart = document.querySelector('#graph');
    console.log(chart);
    chart.innerHTML = '<h1>Hi!</h1>';

    const dates = dateList.map((d) => new Date(+d).toISOString().slice(0, 10));

    console.log(counties);

    // const curtime = new Date($('#curtime').val()).getTime();
    const curtime = new Date('2020-03-01').getTime();

    const filterTime = (data) => Object.entries(data.data).filter((entry) => entry[0] > curtime);
    const countyData = Object.values(counties).map(filterTime).flat().map((entry) => [new Date(+entry[0]).getTime(), entry[1]]);

    let series = {};
    countyData.forEach((entry) => {
      if (series[entry[0]] === undefined) {
        series[entry[0]] = {
          confirmed: 0,
          deaths: 0,
        };
      }

      series[entry[0]].confirmed += entry[1].confirmed;
      series[entry[0]].deaths += entry[1].deaths;
    });

    let c3data = [
      ['x'],
      ['confirmed'],
      ['deaths'],
    ];

    Object.entries(series)
      .sort((a, b) => a[0] - b[0])
      .forEach((entry) => {
        const date = new Date(+entry[0]).toISOString().slice(0, 10);
        const confirmed = entry[1].confirmed;
        const deaths = entry[1].deaths;

        c3data[0].push(date);
        c3data[1].push(confirmed);
        c3data[2].push(deaths);
      });

    console.log(c3data);
  }());

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
  let proportion = +$('#sampling').val(), offset = 0, randomize = true;

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
    for (let i = randomize ? 0 : offset; i < county.population; i += proportion) {
      let pt;
      let id = i;
      if (randomize) {
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
  let data = markers.data(), datalen = data.length, d, c, i, i3;
  let mapper = markers.actors()[0].mapper();
  /*
  let radius = new Array(datalen),
      symbol = new Array(datalen),
      symbolValue = new Array(datalen),
      fillColor = new Array(datalen),
      fillOpacity = new Array(datalen);
   */
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
      radius[i] = 9;
      symbol[i] = geo.markerFeature.symbols.star12 * 64;
      symbolValue[i] = 0.75;
      fillColor[i3] = dc.r;
      fillColor[i3 + 1] = dc.g;
      fillColor[i3 + 2] = dc.b;
      fillOpacity[i] = 1;
    } else if (d.id < c.confirmed) {
      radius[i] = 8;
      symbol[i] = geo.markerFeature.symbols.jack12 * 64;
      symbolValue[i] = 0.25;
      fillColor[i3] = cc.r;
      fillColor[i3 + 1] = cc.g;
      fillColor[i3 + 2] = cc.b;
      fillOpacity[i] = 0.75;
    } else {
      radius[i] = 6;
      symbol[i] = geo.markerFeature.symbols.circle * 64;
      symbolValue[i] = 1;
      fillColor[i3] = oc.r;
      fillColor[i3 + 1] = oc.g;
      fillColor[i3 + 2] = oc.b;
      fillOpacity[i] = 0.25;
    }
  }
  /*
  markers.updateStyleFromArray({
    radius: radius,
    symbolComputed: symbol,
    symbolValueComputed: symbolValue,
    fillColor: fillColor,
    fillOpacity: fillOpacity
  });
  */
  mapper.updateSourceBuffer('radius');
  mapper.updateSourceBuffer('symbol');
  mapper.updateSourceBuffer('symbolValue');
  mapper.updateSourceBuffer('fillColor');
  mapper.updateSourceBuffer('fillOpacity');
  markers.renderer()._render();
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
  var isplaying = playing;
  if (newtime !== datePos) {
    playStop();
    datePos = newtime;
    dateVal = dateList[datePos];
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
  datePos = (datePos + 1) % dateList.length;
  dateVal = dateList[datePos];
  playTimer = window.setTimeout(playStart, 1000 / speed);
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
      datePos = (datePos + 1) % dateList.length;
      dateVal = dateList[datePos];
      updateView();
      break;
    case 'stop':
      playStop();
      break;
  }
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

// sources:
// https://eric.clst.org/tech/usgeojson/
// https://raw.githubusercontent.com/nytimes/covid-19-data/master/us-counties.csv
// ?
// https://covid19.healthdata.org/projections
// https://covidtracking.com/data  -- daily by state
// https://www.unacast.com/covid19/social-distancing-scoreboard
// https://dataforgood.fb.com/tools/disease-prevention-maps/  -- no clear data
// https://coronadatascraper.com/#home
// https://github.com/CSSEGISandData/COVID-19  -- John Hopkins
// https://healthweather.us/?mode=Atypical  -- temperature data (we can't legally use)
