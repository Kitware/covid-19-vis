COVID-19 Visualization
======================

Each dot represents a person.  Only a random proportion of the total population is represented.  The dots are randomly placed in the county of residence.  The sampling control determines how many dots are shown (1 per *sampling* number in the population).

The counties are shaded based on the highest per-capita values for each data field (transparent is zero, opaque is the highest per-capita value).

The data on the graph is based on the counties in the current window; counties that are partially visible are weighted proprotionate to the area that is visible.

Data Source
-----------

This uses the `John Hopkins CSSE data <https://github.com/CSSEGISandData/COVID-19>`_.

County boundaries were obtained from census data via `this site <https://eric.clst.org/tech/usgeojson/>`_.

Code Source
-----------

This repository includes a development build of `geojs <https://github.com/OpenGeoscience/geojs>`_, which includes some recent pull requests.

This uses a branch from `polybooljs <https://github.com/manubb/polybooljs>`_ to calculate the area of counties in the viewport.  Specifically, the `eps-logic` branch was built and included locally.

