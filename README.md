# Extrace AppManager logfile for Power Quality Data push

## Install

Prerequisites:

- nodejs
- R, and below R libraries:
    - dplyr
    - ggplot2
    - patchwork

Install nodejs dependencies:

```
$ npm i
```

## Usage

### Create a data-set directory and cd into it.
```
$ mkdir mydata-01
$ cd mydata-01
  ```

### Extract info from the logfile
```
Usage: extra-pqd-recv-log.js -i dev-id logfile

Options:
    --version   Show version number                                  [boolean]
-i, --dev-id    device ID (serial number)                  [number] [required]
-h, --help      Show help                                            [boolean]
```
Example:
```
$ ../extra-pdq-recv-log.js -i 1373892682 ../data/appmgr.log
```

Two JSON and one csv reports will be generated

- event-seq-<dev-id>.json: Time sequence of data-post and data-msg-processed
  events extracted from the logfile for the giving device.
- data-msg-<dev-id>.json: List of all the processed data point, i.e., AppOS
  message has been decrypted by Power Manger and the embedded Power
  Quality Data (PQD) has been decoded by this tool.
- data-timing-<dev-id>.json: Timing data for the received data points, which
  will be used for plotting in the next step.

### Plot

```
$ ../plot.R data-timing-1373892682.csv [timezone]
```

timezone:
    Assumming the timestamps in server logfile are in UTC, this argument
    determines what timezone will be used in ploting. The value should be a
    POSIX timezone identifier, e.g., Australia/Sydney, Asian/Shanghai.  Default
    is UTC.
