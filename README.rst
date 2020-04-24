COVID-19 Visualization
======================

This shows confirmed cases and deaths in the USA, as reported by the `2019 Novel Coronavirus COVID-19 (2019-nCoV) Data Repository by Johns Hopkins CSSE <https://github.com/CSSEGISandData/COVID-19>`_.

The data is per county in the US.  When showing markers, markers are distributed randomly through each county based on the number present.  These markers **do not represent actual people or locations**.

One marker is drawn per confirmed case (yellow) or death (red).  Markers are randomly distributed within the county for which they are reported.  These do not represent specific people or locations; distribution is only to provide relative densities of cases.

Counties can also be shaded based on the number of cases or deaths per capita, with the county with the most extreme value shown as a solid color, and those with less incidents per capita shown with a translucent color.
      
The graph data is based on the counties on the visible map.  Zooming or panning the map will adjust the graph.  Values include all visible counties, with partially visible counties included proportionate to their visible area.

Data Source
-----------

This uses the `John Hopkins CSSE data <https://github.com/CSSEGISandData/COVID-19>`_.

County boundaries were obtained from census data via `this site <https://eric.clst.org/tech/usgeojson/>`_.

Code Source
-----------

This repository includes a development build of `geojs <https://github.com/OpenGeoscience/geojs>`_, which includes some recent pull requests.

This uses a branch from `polybooljs <https://github.com/manubb/polybooljs>`_ to calculate the area of counties in the viewport.  Specifically, the `eps-logic` branch was built and included locally.

Kitware Blog Post
-----------------

This was announced by a `Kitware Blog Post <https://blog.kitware.com/covid-19-visualization-application-includes-new-ways-to-view-data-for-cases-in-the-u-s/>`_ on April 17, 2020.

