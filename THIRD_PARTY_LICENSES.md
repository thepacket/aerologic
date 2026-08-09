# Third-party licenses

## SHARPpy (databases and ported algorithm)

The following components originate from the
[SHARPpy](https://github.com/sharppy/SHARPpy) project:

- `src/assets/sars_hail.txt` — SPC hail proximity-sounding database
  (Ryan Jewell, NOAA Storm Prediction Center)
- `src/assets/sars_supercell.txt` — SPC supercell proximity-sounding database
  (Rich Thompson, NOAA Storm Prediction Center)
- `src/assets/PW-mean-inches.txt`, `src/assets/PW-stdev-inches.txt` —
  precipitable-water climatology per radiosonde station
- `src/met/sars.ts` — TypeScript port of the SARS matching algorithm from
  `sharppy/databases/sars.py` (Python implementation by Greg Blumberg and
  Kelton Halbert)

SHARPpy is distributed under the BSD 3-Clause license:

```
Copyright (c) 2011, Patrick T. Marsh & John Hart.
All rights reserved.

Copyright (c) 2012, MetPy Developers.
All rights reserved.

Copyright (c) 2020, Kelton Halbert, Greg Blumberg & Tim Supinie.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.

    * Redistributions in binary form must reproduce the above
      copyright notice, this list of conditions and the following
      disclaimer in the documentation and/or other materials provided
      with the distribution.

    * Neither the name of the MetPy Developers nor the names of any
      contributors may be used to endorse or promote products derived
      from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Natural Earth

`src/assets/land110.json` (world land polygons) is from
[Natural Earth](https://www.naturalearthdata.com/), which is in the
public domain.
